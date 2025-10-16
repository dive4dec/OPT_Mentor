const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
// var WebpackOnBuildPlugin = require('on-build-webpack');
// var exec = require('child_process').exec;

// Build-time injection via environment variables (set in CI)
const injectApi = String(process.env.INJECT_API_CONFIG || '').toLowerCase() === 'true';
// Inherit from INJECT_API_CONFIG when API_HIDE_API_PANEL is empty string or unset
const hideApiPanel = String(process.env.API_HIDE_API_PANEL || process.env.INJECT_API_CONFIG || '').toLowerCase() === 'true';
const injectTarget = String(process.env.API_INJECT_TARGET || 'window').toLowerCase();
// Build window variables only when targeting window injection; otherwise leave undefined
const windowVars = (injectApi && injectTarget === 'window') ? {
  // Only include non-empty values; API_KEY respects empty string to allow clearing
  ...(process.env.API_BASE_URL ? { API_BASE_URL: String(process.env.API_BASE_URL).trim() } : {}),
  ...(process.env.API_KEY !== undefined ? { API_KEY: process.env.API_KEY } : {}),
  ...(process.env.API_MODEL ? { API_MODEL: String(process.env.API_MODEL).trim() } : {}),
  // UI-only flag controlling whether to show the API panel
  API_HIDE_API_PANEL: hideApiPanel,
  // Mode lock: 'local' | 'api' | ''
  ...(process.env.SINGLE_MODE ? { SINGLE_MODE: String(process.env.SINGLE_MODE).trim().toLowerCase() } : {}),
} : undefined;

// Build-time JS define injection when API_INJECT_TARGET === 'define'
const defineReplacements = {};
if (injectApi && injectTarget === 'define') {
  defineReplacements.__API_BASE_URL__ = JSON.stringify(process.env.API_BASE_URL || '');
  defineReplacements.__API_KEY__ = JSON.stringify(process.env.API_KEY || '');
  defineReplacements.__API_MODEL__ = JSON.stringify(process.env.API_MODEL || '');
  defineReplacements.__API_DEFAULT_MODE__ = JSON.stringify(process.env.API_DEFAULT_MODE || '');
  // Also expose the UI-only flag via define to keep behavior consistent with window mode
  defineReplacements.__API_HIDE_API_PANEL__ = JSON.stringify(hideApiPanel);
  // Mode lock
  defineReplacements.__SINGLE_MODE__ = JSON.stringify((process.env.SINGLE_MODE || '').toLowerCase());
}

module.exports = {
    plugins: [
      // http://stackoverflow.com/questions/29080148/expose-jquery-to-real-window-object-with-webpack
      new webpack.ProvidePlugin({
        // Automtically detect jQuery and $ as free var in modules
        // and inject the jquery library
        // This is required by many jquery plugins
        jquery: "jquery",
        jQuery: "jquery",
        $: "jquery"
      }),
      new HtmlWebpackPlugin({
        filename: "index.html",
        title: 'Visualize Python Code Execution',
        chunks: ['visualize'],
        template: './js/template/visualize.html',
        window: windowVars,
      }),
      new HtmlWebpackPlugin({
        filename: "live.html",
        title: 'Live Python Programming Mode',
        chunks: ['opt-live'],
        template: './js/template/live.html',
        window: windowVars,
      }),
      ...(injectTarget === 'define' ? [new webpack.DefinePlugin(defineReplacements)] : [])
      // run a micro frontend regression test after every webpack build
      // to sanity-check
      //
      // TODO: get frontend regression tests working again before re-enabling them:
      /*
      new WebpackOnBuildPlugin(function(stats) {
        console.log("\n");
        exec("cd ../tests/frontend-regression-tests/ && make micro", (error, stdout, stderr) => {
          console.log(stdout);
          if (stderr) {
            console.log(`Test stderr: ${stderr}`);
          }
        });
      }),
      */
    ],

    // some included libraries reference 'jquery', so point to it:
    resolve : {
        // VERY IMPORTANT to put .ts *FIRST* (or as the only item) in
        // this list (if you're going to list other stuff), so that module
        // names first resolve to .ts files
        //
        // this way, you can import modules like this without the .ts
        // extension:
        // import {ExecutionVisualizer} from './pytutor';
        //
        // for some reason, you're not allowed to put explicit filename
        // extensions in newer versions of webpack, so we need this line:
        extensions: ['.ts', '.js', '.css'],

        alias: {
            "jquery": __dirname + "/js/lib/jquery-3.0.0.min.js",
            "$": __dirname + "/js/lib/jquery-3.0.0.min.js",
            "$.bbq": __dirname + "/js/lib/jquery.ba-bbq.js",
        }
    },

    entry: {
        'visualize': "./js/visualize.ts",
        'opt-live': "./js/opt-live.ts"
    },

    output: {
        path: __dirname + "/build/",
        // TODO: use 'bundle.[hash].js' for fingerprint hashing
        // to create unique filenames for releases:
        // https://webpack.github.io/docs/long-term-caching.html
        filename: "[name].bundle.js",
        sourceMapFilename: "[file].map",
    },

    // optimization: {
    //   splitChunks: {
    //     chunks: 'all',
    //   },
    // },

    module: {
        rules: [
            { 
              test: /\.css$/, 
              use: ["style-loader", "css-loader"] 
            }, // CSS
            {
              test: /\.(png|svg|jpg|jpeg|gif)$/i,
              type: 'asset/resource',
            }, // Image
            { 
              test: /\.tsx?$/,
              use: 'ts-loader',
              exclude: /node_modules/,
            }, // TypeScript
            {
              test: /\.ttf$/,
              type: 'asset/resource'
            },  // Font
            { 
              test: /\.hbs$/, 
              loader: "handlebars-loader" 
            },
            {
              test: /\.whl$/,
              type: 'asset/resource',
              generator: {
                filename: 'static/[name][ext]'
              }
            },  // Python wheel
        ]
    },

    //devtool: 'source-map', // source maps are very important to ease debugging
    // nix this, and use the command-line option "--devtool sourcemap" to create
    // source maps in a debugging build
    devServer: {
      static: {
        directory: path.join(__dirname, './'),
      },
      compress: true,
      port: 8000,
    },
};
