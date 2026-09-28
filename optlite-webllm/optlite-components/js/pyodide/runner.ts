import { OptLite, combineDefaults } from './global'
import { default as optlite } from '../../dist/optlite-0.0.6-py2.py3-none-any.whl';

// Pyodide v314+ requires a module worker (classic workers no longer supported).
// The worker is built as a separate webpack entry point, referenced BY NAME at
// runtime (webpack's WorkerPlugin can't be used here because it strips the
// `module` flag unless output.module is on). We resolve its URL relative to the
// main bundle's URL (document.currentScript.src in classic output,
// import.meta.url in module output) and create it with { type: "module" }.
//
// CACHE-BUSTING: the worker is served with `Cache-Control: public, immutable`
// (nginx.conf). A bare fixed name like "optworker.bundle.js" would be pinned to
// whichever version a browser first fetched — after a deploy that changes the
// worker but not its name, a hard refresh re-fetches the hash-busted MAIN bundle
// but the immutable stale worker keeps being used (this is why Jedi completion
// "didn't work" until incognito after v29). webpack names the worker with a
// per-content token (__OPT_WORKER_TOKEN__, injected by DefinePlugin in
// webpack.config.js) that changes whenever the worker changes, so its URL
// orphans the stale cache on every deploy. The token is a compile-time const,
// so it inlines into this bundle (no import / runtime resolution needed).
const pyodideWorker = (() => {
  const bundleUrl = typeof document !== 'undefined' && document.currentScript
    ? (document.currentScript as HTMLScriptElement).src
    : import.meta.url;
  const base = bundleUrl.replace(/[^/]*$/, '');
  const workerName = 'optworker.bundle.' + __OPT_WORKER_TOKEN__ + '.js';
  return new Worker(base + workerName, { type: "module" });
})();
const callbacks: Record<number, (data: any) => void> = {};

// ask worker to initialize pyodide based on the configuration 
// in a global OptLite object predefined before loading pyodide.
const initWorker = (() => {
  let id = -1; // use -ve job id for initialization
  combineDefaults( OptLite, {
    pyodide: "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js",
    optlite: optlite,
    packages: [],
  });
  // Force absolute URL — combineDefaults won't override if already set by user config
  OptLite.optlite = new URL(OptLite.optlite, window.location.href).href;
  return () => {
    return new Promise((resolve, reject) => {
      callbacks[id] = (data) => {
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      pyodideWorker.postMessage({
        id, 
        ...OptLite
      });
    });
  }
})();
let init = initWorker();

// handle results from worker
pyodideWorker.onmessage = async (event) => {
  const { id, ...data } = event.data;
  const cb = callbacks[id];
  if (cb) {
    delete callbacks[id];
    cb(data);
  }
};

const asyncRun = (() => {
  let id = 0;
  return (script: string, rawInputLst: string[], options: any) => {
    id = (id + 1) % Number.MAX_SAFE_INTEGER;
    return new Promise((resolve, reject) => {
      init.then(() => {
        callbacks[id] = (data) => {
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        };
        pyodideWorker.postMessage({
          ...options,
          script: script,
          rawInputLst: rawInputLst,
          id,
        });
      }).catch(reject);
    });
  };
})();

// --- Python code completion via Jedi (runs in the worker) ------------------
// Lets the editor complete attribute/member access (`str.` -> format/join)
// from the *visible* code. Static analysis (jedi.Script), so it works without
// executing and is safe on buggy code. See optworker.mjs 'complete' branch.
//
// Latency/safety guarantees (all verified against the loaded @codemirror/
// autocomplete 6.20.3):
//   * Non-blocking: a CompletionSource may return a Promise, so the editor
//     shows results as they arrive and never waits on the worker.
//   * Stale results: CodeMirror aborts an in-flight query when the doc changes
//     (context.aborted) and coalesces rapid typing via activateOnTypingDelay,
//     so a slow `str.` result from an earlier keystroke is discarded, not shown.
//   * Busy worker: if the worker is blocked running a long script, the
//     client-side timeout below still settles the Promise (with null), so the
//     completion UI degrades to the static list rather than hanging.
let completionId = 0;
const COMPLETION_TIMEOUT_MS = 6000;
const timeouts: Record<number, any> = {};

const pyComplete = (() => {
  return (code: string, line: number, column: number): Promise<Array<{name: string, type: string}> | null> => {
    // Negative id namespace: the worker routes completion messages by
    // `type === 'complete'` (not by id), so a negative id is safe on the wire,
    // and it can never collide with asyncRun's non-negative ids or init's -1
    // in the shared `callbacks` map. (A collision there is exactly what made a
    // completion reply get consumed by a concurrent auto-execution in live mode.)
    const id = -2 - completionId++;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: Array<{name: string, type: string}> | null) => {
        if (settled) return;
        settled = true;
        const t = timeouts[id];
        if (t) { clearTimeout(t); delete timeouts[id]; }
        delete callbacks[id];
        resolve(value);
      };
      callbacks[id] = (data: any) => {
        finish(data && !data.error ? (data.suggestions || null) : null);
      };
      // Safety net: if the worker is busy (long script running) we still settle.
      timeouts[id] = setTimeout(() => finish(null), COMPLETION_TIMEOUT_MS);
      init.then(() => {
        pyodideWorker.postMessage({ type: 'complete', code, line, column, id });
      }).catch(() => finish(null));
    });
  };
})();

// --- Symbol inference (Jedi, static analysis) — "what is this name?" --------
// Mirrors pyComplete: async, non-blocking, with a client-side timeout so a busy
// worker degrades to "no help" instead of hanging the shortcut. Returns the
// resolved symbol's name/type/module/docstring, or null if it can't resolve
// (e.g. a plain local variable with no docstring, or an unknown name).
export type PyInferResult = {
  name: string; type: string; module: string; tostr: string; doc: string;
};

let inferId = 0;
const INFER_TIMEOUT_MS = 6000;
const inferTimeouts: Record<number, any> = {};

const pyInfer = (() => {
  return (code: string, line: number, column: number): Promise<PyInferResult | null> => {
    // Own negative id namespace (one below completion's) so an infer reply can
    // never be consumed by a concurrent completion/auto-execution in the shared
    // `callbacks` map.
    const id = -100 - inferId++;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: PyInferResult | null) => {
        if (settled) return;
        settled = true;
        const t = inferTimeouts[id];
        if (t) { clearTimeout(t); delete inferTimeouts[id]; }
        delete callbacks[id];
        resolve(value);
      };
      callbacks[id] = (data: any) => {
        finish(data && !data.error && data.tostr !== undefined ? (data as PyInferResult) : null);
      };
      inferTimeouts[id] = setTimeout(() => finish(null), INFER_TIMEOUT_MS);
      init.then(() => {
        pyodideWorker.postMessage({ type: 'infer', code, line, column, id });
      }).catch(() => finish(null));
    });
  };
})();

export { asyncRun, pyComplete, pyInfer };
