'use strict';
const fs = require('fs');

function serializeArray(arr, log, updater) {
  return arr.reduce(
    (promise, elem) => promise
      .then(() => updater(elem))
      .catch(err => log.error(err)),
    Promise.resolve());
}

function saveJson(path, data, log) {
  if (!log) log = console;
  log.debug(`saveJson(${path})`);
  fs.createWriteStream(path).write(JSON.stringify(data, null, 2));
}

function loadJsonSync(path, log) {
  if (!log) log = console;
  if (!fs.existsSync(path)) {
    log.error(`load JSON filed, file not found ${path}`);
    return null;
  }
  log.debug(`loadJsonSync(${path})`);
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

module.exports = {
  serializeArray,
  saveJson,
  loadJsonSync
};