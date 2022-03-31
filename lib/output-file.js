'use strict';

const path = require('path');
const fs = require('fs').promises;

async function outputFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

module.exports = outputFile;
