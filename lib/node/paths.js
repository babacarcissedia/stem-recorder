'use strict';

const path = require('path');

function outRoot() {
  if (process.env.STEM_OUT_ROOT) return process.env.STEM_OUT_ROOT;
  // Lazy-require electron only when running inside the app
  const { app } = require('electron');
  return path.join(app.getPath('videos'), 'stem-recorder');
}

module.exports = { outRoot };
