const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// Build-time injection via environment variables (set in CI or Dockerfile)
const injectApi = String(process.env.INJECT_API_CONFIG || '').toLowerCase() === 'true';
const hideApiPanel = String(process.env.API_HIDE_API_PANEL || process.env.INJECT_API_CONFIG || '').toLowerCase() === 'true';
const injectTarget = String(process.env.API_INJECT_TARGET || 'window').toLowerCase();

// Sub-path deployment: set PUBLIC_PATH=/OPT_Mentor/ when serving under a sub-path.
// When unset (e.g., GitHub Actions → GH Pages), omit publicPath entirely so
// webpack uses its default behavior (relative URLs in HtmlWebpackPlugin).
const publicPath = process.env.PUBLIC_PATH || undefined;

const windowVars = (injectApi && injectTarget === 'window') ? {
  ...(process.env.API_BASE_URL ? { API_BASE_URL: String(process.env.API_BASE_URL).trim() } : {}),
  ...(process.env.API_KEY !== undefined ? { API_KEY: process.env.API_KEY } : {}),
  ...(process.env.API_MODEL ? { API_MODEL: String(process.env.API_MODEL).trim() } : {}),
  API_HIDE_API_PANEL: hideApiPanel,
  ...(process.env.SINGLE_MODE ? { SINGLE_MODE: String(process.env.SINGLE_MODE).trim().toLowerCase() } : {}),
} : undefined;

const defineReplacements = {};
if (injectApi && injectTarget === 'define') {
  defineReplacements.__API_BASE_URL__ = JSON.stringify(process.env.API_BASE_URL || '');
  defineReplacements.__API_KEY__ = JSON.stringify(process.env.API_KEY || '');
  defineReplacements.__API_MODEL__ = JSON.stringify(process.env.API_MODEL || '');
  defineReplacements.__API_DEFAULT_MODE__ = JSON.stringify(process.env.API_DEFAULT_MODE || '');
  defineReplacements.__API_HIDE_API_PANEL__ = JSON.stringify(hideApiPanel);
  defineReplacements.__SINGLE_MODE__ = JSON.stringify((process.env.SINGLE_MODE || '').toLowerCase());
}

module.exports = {
    plugins: [
      // http://stackoverflow.com/questions/29080148/expose-jquery-to-real-window-object-with-webpack
      new webpack.ProvidePlugin({
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
      // Same app as index.html; keeps permalinks and openLiveModeUrl() working as live.html#...
      new HtmlWebpackPlugin({
        filename: "live.html",
        title: 'Live Python Programming Mode',
        chunks: ['opt-live'],
        template: './js/template/live.html',
        window: windowVars,
      }),
      new HtmlWebpackPlugin({
        filename: "visualize.html",
        title: 'Visualize Python Code Execution',
        chunks: ['visualize'],
        template: './js/template/visualize.html',
        window: windowVars,
      }),
      ...(injectTarget === 'define' ? [new webpack.DefinePlugin(defineReplacements)] : [])
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
        ...(publicPath ? { publicPath } : {}),
        filename: "[name].bundle.[contenthash:8].js",
        sourceMapFilename: "[file].map",
    },

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

    devServer: {
      static: {
        directory: path.join(__dirname, './'),
      },
      compress: true,
      port: 8000,
    },
};
