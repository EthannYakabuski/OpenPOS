const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
module.exports = (_, argv) => {
  const production = argv.mode === 'production';
  const common = {
    mode: production ? 'production' : 'development',
    devtool: production ? 'source-map' : 'source-map',
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: { transpileOnly: true, compilerOptions: { noEmit: false } }
          }
        }
      ]
    },
    stats: 'errors-warnings'
  };
  return [
    {
      ...common,
      name: 'main',
      target: 'electron-main',
      entry: './src/main/main.ts',
      output: { path: path.resolve('dist/main'), filename: 'main.js', clean: true },
      node: { __dirname: false, __filename: false },
      plugins: [
        new CopyPlugin({
          patterns: [
            { from: 'docs/help.html', to: '../help/help.html' },
            { from: 'docs/style.css', to: '../help/style.css' },
            { from: 'assets/icon.png', to: '../assets/icon.png' },
            { from: 'assets/logo.svg', to: '../assets/logo.svg' }
          ]
        })
      ]
    },
    {
      ...common,
      name: 'preload',
      target: 'electron-preload',
      entry: './src/main/preload.ts',
      output: { path: path.resolve('dist/preload'), filename: 'preload.js', clean: true }
    },
    {
      ...common,
      name: 'renderer',
      target: 'web',
      entry: './src/renderer/index.tsx',
      output: { path: path.resolve('dist/renderer'), filename: 'app.js', clean: true },
      module: {
        rules: [...common.module.rules, { test: /\.css$/, use: ['style-loader', 'css-loader'] }]
      },
      plugins: [new HtmlWebpackPlugin({ template: './src/renderer/index.html', inject: 'body' })],
      performance: { hints: false }
    }
  ];
};
