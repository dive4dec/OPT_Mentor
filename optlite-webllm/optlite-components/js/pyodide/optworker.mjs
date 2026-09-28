// Module worker — required by Pyodide v314+ (classic workers no longer supported)

self.onmessage = async (event) => {
  // copy the context in worker's own "memory"
  const { id, ...context } = event.data;
  for (const key of Object.keys(context)) {
    self[key] = context[key];
  }

  // --- Code completion (Jedi, static analysis) ------------------------------
  // Request: { type:'complete', id, code, line, column }
  // Reply:   { suggestions: [{name, type}, ...], id }  |  { error, id }
  //
  // Uses jedi.Script(code).complete(...) — pure STATIC analysis of the visible
  // code (no execution, no live globals). This is what makes attribute
  // completion like `str.` -> format/join/split work, and it works even on
  // buggy code that hasn't been run. `line` is 1-based, `column` 0-based
  // (Jedi's contract). `code` is passed as a real argument (never interpolated
  // into the Python source) so user code with quotes/newlines is safe.
  if (context.type === 'complete') {
    try {
      if (!self._cm_complete) {
        // Lazy-load Jedi (prebuilt package, no pip) on first completion.
        await self.pyodide.loadPackage('jedi');
        // Return a JSON *string* (not a list-of-dicts). pyodide hands back a
        // list-of-objects as PyProxy wrappers, which are NOT structured-cloneable
        // and make worker postMessage throw "could not be cloned". A JSON string
        // round-trips cleanly and we JSON.parse it here into plain objects.
        self.pyodide.runPython(`
import jedi, json
def _cm_complete(code, line, column):
    try:
        return json.dumps([{'name': x.name, 'type': x.type}
                for x in jedi.Script(code).complete(line=line, column=column)])
    except Exception:
        return '[]'
`);
        self._cm_complete = self.pyodide.globals.get('_cm_complete');
        self.jediReady = true;
      }
      const { code, line, column } = context;
      const parsed = JSON.parse(self._cm_complete(code, line, column) || '[]');
      self.postMessage({ suggestions: parsed, id });
    } catch (error) {
      self.postMessage({ error: 'completion failed: ' + error.message, id });
    }
    return;
  }

  // --- Symbol infer (Jedi, static analysis) — "what is this name?" ----------
  // Request: { type:'infer', id, code, line, column }   (1-based line, 0-based col)
  // Reply:   { name, type, module, tostr, doc, id }  |  { id }  (empty when nothing resolved)
  //
  // jedi.Script(code).infer(line, column) resolves the *identifier at the cursor*
  // to its definition(s) without executing. Each InferenceResult exposes .module
  // (name), .to_string() (human-friendly repr, e.g. "def str(...)" / "class int"),
  // and .docstring (the symbol's own Python docstring — the actual help text).
  // We take the first result. `line`/`column` are passed as real arguments so
  // user code with quotes/newlines can't break the Python source.
  if (context.type === 'infer') {
    try {
      if (!self._cm_infer) {
        await self.pyodide.loadPackage('jedi');
        self.pyodide.runPython(`
import jedi, json
def _cm_infer(code, line, column):
    def _s(x):
        try:
            return '' if x is None else str(x)
        except Exception:
            return ''
    try:
        results = list(jedi.Script(code).infer(line=line, column=column))
    except Exception:
        return ''
    if not results:
        return ''
    r = results[0]
    try:
        tostr = r.to_string()
    except Exception:
        tostr = ''
    # .docstring is a STRING in jedi <0.20 but a METHOD in >=0.20 — handle both.
    try:
        ds = r.docstring
        doc = ds if isinstance(ds, str) else (ds() if callable(ds) else '')
        doc = _s(doc)
    except Exception:
        doc = ''
    # .module is absent/None for builtins and unresolvable names — getattr-guard it.
    d = {'name': _s(r.name), 'type': _s(r.type),
         'module': _s(getattr(r, 'module', '')), 'tostr': _s(tostr), 'doc': doc}
    return json.dumps(d)
`);
        self._cm_infer = self.pyodide.globals.get('_cm_infer');
      }
      const { code, line, column } = context;
      const raw = self._cm_infer(code, line, column) || '';
      const parsed = raw ? JSON.parse(raw) : null;
      self.postMessage(parsed ? Object.assign({}, parsed, { id }) : { id });
    } catch (error) {
      self.postMessage({ error: 'infer failed: ' + error.message, id });
    }
    return;
  }

  try {
    let results;
    if (id < 0) { // initialize worker
      // load pyodide from its url — indexURL must match the CDN folder or loadPackage can fail silently / 404.
      const pyodideUrl = self.pyodide;
      const indexURL = pyodideUrl.replace(/\/[^/]*$/, "/");
      // Dynamic import the pyodide.js UMD bundle (it assigns loadPyodide to globalThis)
      await import(/* webpackIgnore: true */ pyodideUrl);
      self.pyodide = await loadPyodide({ indexURL });
      await self.pyodide.loadPackage("micropip");
      // pydoc_data is still in the distribution but needs to be explicitly loaded
      // with loadPackage("pydoc_data") to use help('for') etc.
      // await self.pyodide.loadPackage("pydoc_data");
      // fetch and install optlite from pypi
      results = await self.pyodide.runPythonAsync(`
      import micropip
      from js import packages, optlite
      await micropip.install(optlite)
      for p in packages:
          await micropip.install(p)
      `)
      // Warm up Jedi in the BACKGROUND so the first completion is fast.
      // Fire-and-forget (not awaited): does not delay init. Pre-building the
      // index with a throwaway `str.` completion hides the ~3s cold cost.
      self.pyodide.loadPackage("jedi")
        .then(() => { self.pyodide.runPython('import jedi; jedi.Script("str.").complete()'); })
        .catch(() => { /* completion will lazy-load Jedi on demand */ });
    } else { // visualize code
      await self.pyodide.loadPackagesFromImports(self.script);
      results = await self.pyodide.runPythonAsync(`
      import optlite
      from js import script, rawInputLst
      optlite.exec_script(script, rawInputLst)
      `);
    }
    self.postMessage({ results, id });
  } catch (error) {
    self.postMessage({ error: "Failed to run code: "+error.message, id });
  }
};
