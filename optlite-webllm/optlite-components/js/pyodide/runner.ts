import { OptLite, combineDefaults } from './global'
import { default as optlite } from '../../dist/optlite-0.0.6-py2.py3-none-any.whl';

// Pyodide v314+ requires a module worker (classic workers no longer supported).
// The worker is built as a separate webpack entry point (optworker.bundle.*.js).
// We resolve its URL relative to the main bundle's URL (import.meta.url in
// module output, or document.currentScript in classic output), then create
// the Worker with { type: "module" } to bypass webpack's worker handling
// (which strips the module flag when output.module is not enabled).
const pyodideWorker = (() => {
  // Get the base URL of the current bundle directory
  const bundleUrl = typeof document !== 'undefined' && document.currentScript
    ? (document.currentScript as HTMLScriptElement).src
    : import.meta.url;
  const baseUrl = bundleUrl.replace(/[^/]*$/, '');
  // The worker filename pattern: optworker.bundle.[hash].js
  // We use a wildcard fetch to find the exact filename at runtime.
  // Fallback: try common hash-free name first.
  return new Worker(baseUrl + 'optworker.bundle.js', { type: "module" });
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

export { asyncRun };
