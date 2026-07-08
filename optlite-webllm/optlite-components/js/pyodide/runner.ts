import { OptLite, combineDefaults } from './global'
import { default as optlite } from '../../dist/optlite-0.0.5-py2.py3-none-any.whl';

const pyodideWorker = new Worker(new URL("./optworker.js", import.meta.url));
const callbacks: Record<number, (data: any) => void> = {};

// ask worker to initialize pyodide based on the configuration 
// in a global OptLite object predefined before loading pyodide.
const initWorker = (() => {
  let id = -1; // use -ve job id for initialization
  combineDefaults( OptLite, {
    pyodide: "https://cdn.jsdelivr.net/pyodide/v0.27.3/full/pyodide.js",
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
