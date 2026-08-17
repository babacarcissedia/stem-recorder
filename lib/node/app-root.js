'use strict';

const path = require('path');

function appRoot() {
  return process.env.STEM_APP_ROOT || path.join(__dirname, '..', '..');
}

module.exports = { appRoot };
