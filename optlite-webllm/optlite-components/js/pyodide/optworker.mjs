// Module worker — required by Pyodide v314+ (classic workers no longer supported)

self.onmessage = async (event) => {
  // copy the context in worker's own "memory"
  const { id, ...context } = event.data;
  for (const key of Object.keys(context)) {
    self[key] = context[key];
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
