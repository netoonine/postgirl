#!/usr/bin/env node
// Ponto de entrada da CLI. Gere out/ antes com `npm run build`.
const path = require('path')
const fs = require('fs')

// alguma dependência toca em globalThis.localStorage; no Node 25+ isso gera um aviso sem utilidade aqui
const emitWarning = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes('localStorage')) return
  return emitWarning.call(process, warning, ...rest)
}

const built = path.join(__dirname, '..', 'out', 'main', 'cli.js')
if (!fs.existsSync(built)) {
  console.error('Postgirl CLI ainda não foi compilada. Rode `npm run build` na raiz do projeto.')
  process.exit(2)
}
require(built)
  .main()
  .then((code) => process.exit(code))
