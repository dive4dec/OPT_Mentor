const path = require('path');
// Rollup's config loader can resolve plugins from an unexpected cwd; anchor to this directory.
const root = __dirname;
const { nodeResolve } = require(path.join(root, 'node_modules/@rollup/plugin-node-resolve'));
const ignore = require(path.join(root, 'node_modules/rollup-plugin-ignore'));
const commonjs = require(path.join(root, 'node_modules/@rollup/plugin-commonjs'));
const typescript = require(path.join(root, 'node_modules/@rollup/plugin-typescript'));

module.exports = {
  input: 'src/index.ts',
  output: [
    {
      file: 'lib/index.js',
      exports: 'named',
      format: 'es',
      sourcemap: true,
      globals: { ws: 'ws', perf_hooks: 'perf_hooks' },
    },
  ],
  plugins: [
    ignore(['fs', 'path', 'crypto']),
    nodeResolve({ browser: true }),
    commonjs({
      ignoreDynamicRequires: true,
    }),
    typescript({ tsconfig: './tsconfig.json' }),
  ],
};
