// web worker

self.onmessage = async (event) => {
  // copy the context in worker's own "memory"
  const { id, ...context } = event.data;
  for (const key of Object.keys(context)) {
    self[key] = context[key];
  }

  try {
    let results;
    if (id < 0) { // initialize worker
      // load pyodide from its url — indexURL must match the CDN folder or loadPackage("pydoc_data") can fail silently / 404.
      const pyodideScript = self.pyodide;
      importScripts(pyodideScript);
      const indexURL = pyodideScript.replace(/\/[^/]*$/, "/");
      self.pyodide = await loadPyodide({ indexURL });
      await self.pyodide.loadPackage("micropip");
      // In the 0.27.3 lockfile, package key is "pydoc-data" (import name is still pydoc_data).
      // pydoc-data is not necessary for help(list), but need to add import pydoc_data for help('for') if self.pyodide.loadPackage("pydoc-data") is not used
      // await self.pyodide.loadPackage("pydoc-data"); 
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