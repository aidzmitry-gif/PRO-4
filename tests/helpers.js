// Прототипы — самодостаточные HTML-файлы, открываем напрямую через file://
const path = require('path');
const { pathToFileURL } = require('url');

const proto = f => pathToFileURL(path.join(__dirname, '..', 'prototypes', 'production', f)).href;

module.exports = { proto };
