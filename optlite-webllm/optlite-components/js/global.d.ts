declare module '*.whl' {
    const content: any;
    export default content;
}

// Per-build cache-busting token for the pyodide worker, injected by
// webpack's DefinePlugin (see workerToken in webpack.config.js). Used by
// pyodide/runner.ts to reference the worker's hashed filename.
declare const __OPT_WORKER_TOKEN__: string;