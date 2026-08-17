'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

function probeDuration(file) {
  if (!fs.existsSync(file)) return 0;
  return Number(spawnSync('ffprobe', [file]).status);
}

module.exports = { probeDuration };
