const { spawn } = require('node:child_process');
const path = require('node:path');
const webpack = require('webpack');
const config = require('../webpack.config.cjs')({}, { mode: 'development' });
require('./icons.cjs');
require('./notices.cjs');
let child;
const launch = () => {
  if (child) return;
  const env = {
    ...process.env,
    OPENPOS_DATA_DIR: process.env.OPENPOS_DATA_DIR || path.resolve('.dev-data')
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), ['.'], { env, stdio: 'inherit', windowsHide: true });
  child.on('exit', () => {
    child = undefined;
    watcher.close(() => process.exit());
  });
};
const watcher = webpack(config).watch(
  { aggregateTimeout: 250, ignored: /node_modules/ },
  (error, stats) => {
    if (error || stats.hasErrors()) {
      console.error(error || stats.toString({ all: false, errors: true }));
      return;
    }
    console.log(
      'OpenPOS compiled. Press Ctrl+R for renderer edits; restart yarn dev for main/preload edits.'
    );
    launch();
  }
);
process.on('SIGINT', () => {
  child?.kill();
  watcher.close(() => process.exit());
});
