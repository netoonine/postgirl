// CLI do Postwoman: roda coleções no terminal e no CI (equivalente ao Newman) e sobe o mock server.
// Usa o mesmo motor do app (src/core), sem Electron.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { CookieJar } from '@postman/tough-cookie'
import type { Environment, EnvValue, NetworkSettings, PMCollection, PMItem, RunnerEvent } from '@shared/types'
import { DEFAULT_NETWORK } from '@shared/types'
import { parseCsv } from '@shared/csv'
import { runCollection } from '../core/engine'
import { importText } from '../core/importer'
import { startMockServer } from '../core/mock'
import { junitReport, RunReport, summarize } from './report'

const VERSION = (() => {
  for (const p of [path.join(__dirname, '../../package.json'), path.join(__dirname, '../package.json')]) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')).version as string
    } catch {
      /* tenta o próximo */
    }
  }
  return 'dev'
})()

// ---------------- cores ----------------

let useColor = !!process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: string) => (s: string | number) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const c = { dim: paint('2'), bold: paint('1'), red: paint('31'), green: paint('32'), yellow: paint('33'), cyan: paint('36'), gray: paint('90') }

// ---------------- argumentos ----------------

interface Args {
  _: string[]
  [k: string]: any
}

const ALIASES: Record<string, string> = {
  e: 'environment',
  g: 'globals',
  d: 'iteration-data',
  n: 'iteration-count',
  w: 'workspace',
  r: 'reporters',
  k: 'insecure',
  p: 'port',
  h: 'help',
  v: 'version'
}
const REPEATABLE = new Set(['env-var', 'global-var', 'folder'])
const FLAGS = new Set(['bail', 'insecure', 'help', 'version', 'no-color', 'silent', 'verbose', 'ignore-redirects'])

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('-') || a === '-') {
      out._.push(a)
      continue
    }
    let [name, inline] = a.replace(/^--?/, '').split(/=(.*)/s, 2) as [string, string | undefined]
    name = ALIASES[name] || name
    if (FLAGS.has(name)) {
      out[name] = inline === undefined ? true : inline !== 'false'
      continue
    }
    const value = inline ?? argv[++i]
    if (value === undefined) throw new Error(`A opção --${name} precisa de um valor`)
    if (REPEATABLE.has(name)) (out[name] ||= []).push(value)
    else out[name] = value
  }
  return out
}

const HELP = `
${'Postwoman CLI'} ${VERSION}

Uso:
  postwoman run <coleção> [opções]     roda uma coleção (arquivo .json ou nome na pasta de trabalho)
  postwoman mock <coleção> [-p 4010]   sobe o mock server com os exemplos salvos
  postwoman list                       lista coleções e ambientes da pasta de trabalho

Opções do run:
  -e, --environment <arquivo|nome>    ambiente (arquivo .postman_environment.json ou nome)
  -g, --globals <arquivo>             variáveis globais
  -d, --iteration-data <arquivo>      CSV ou JSON; uma iteração por linha
  -n, --iteration-count <n>           número de iterações
      --folder <nome|id>              roda só esta pasta (pode repetir)
      --env-var <chave=valor>         define/sobrescreve variável de ambiente (pode repetir)
      --global-var <chave=valor>      define/sobrescreve variável global (pode repetir)
      --delay-request <ms>            espera entre requisições
      --timeout-request <ms>          timeout de cada requisição
      --bail                          para na primeira falha
  -k, --insecure                      não verifica certificados SSL
      --ignore-redirects              não segue redirecionamentos
      --ssl-extra-ca-certs <arquivo>  CA extra (PEM)
      --ssl-client-cert <arquivo>     certificado de cliente (PEM), com --ssl-client-key
      --ssl-client-key <arquivo>      chave do certificado de cliente
      --ssl-client-pfx <arquivo>      certificado de cliente PFX/P12
      --ssl-client-passphrase <senha> senha do certificado
      --proxy <url>                   proxy HTTP/SOCKS para todas as requisições
  -r, --reporters <lista>             cli,json,junit (padrão: cli)
      --reporter-json-export <arq>    onde gravar o relatório JSON
      --reporter-junit-export <arq>   onde gravar o relatório JUnit XML
      --export-environment <arq>      grava o ambiente final (depois dos scripts)
      --silent                        sem saída no terminal
      --no-color                      sem cores

Pasta de trabalho (para achar coleções e ambientes pelo nome):
  -w, --workspace <pasta>             padrão: a pasta atual se tiver collections/, senão ~/Postwoman

Valores secretos do app ficam no Keychain e não estão nos arquivos: passe-os com --env-var.
Código de saída: 0 se tudo passou, 1 se algum teste ou requisição falhou, 2 para erro de uso.
`

// ---------------- leitura de arquivos ----------------

function workspaceDir(a: Args) {
  if (a.workspace) return path.resolve(a.workspace)
  if (process.env.POSTWOMAN_WORKSPACE) return path.resolve(process.env.POSTWOMAN_WORKSPACE)
  if (fs.existsSync(path.join(process.cwd(), 'collections'))) return process.cwd()
  return path.join(os.homedir(), 'Postwoman')
}

const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'))

function listJson(dir: string) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

/** Arquivo existente, ou nome/id procurado em <pasta>/<sub>. */
function locate(ref: string, ws: string, sub: 'collections' | 'environments', nameOf: (j: any) => string, idOf: (j: any) => string) {
  if (fs.existsSync(ref) && fs.statSync(ref).isFile()) return path.resolve(ref)
  const wanted = ref.toLowerCase()
  const candidates = listJson(path.join(ws, sub))
  for (const f of candidates) {
    try {
      const j = readJson(f)
      if (nameOf(j)?.toLowerCase() === wanted || idOf(j)?.startsWith(ref)) return f
    } catch {
      /* arquivo inválido: ignora */
    }
  }
  const names = candidates.map((f) => path.basename(f)).join(', ') || 'nenhum'
  throw new UsageError(`Não encontrei "${ref}" (nem como arquivo, nem em ${path.join(ws, sub)}). Disponíveis: ${names}`)
}

class UsageError extends Error {}

async function loadCollection(ref: string, ws: string): Promise<PMCollection> {
  const file = locate(
    ref,
    ws,
    'collections',
    (j) => j.info?.name,
    (j) => j.info?._postman_id || ''
  )
  // importText aceita v1, v2.0, v2.1 e normaliza ids
  const r = await importText(fs.readFileSync(file, 'utf8'), path.basename(file))
  if (!r.collections[0]) throw new UsageError(`${file} não é uma coleção válida: ${r.errors.join('; ')}`)
  return r.collections[0]
}

function loadEnvironment(ref: string, ws: string): Environment {
  const file = locate(
    ref,
    ws,
    'environments',
    (j) => j.name,
    (j) => j.id || ''
  )
  const j = readJson(file)
  return { id: j.id || randomUUID(), name: j.name || path.basename(file), values: normalizeValues(j.values) }
}

const normalizeValues = (values: any[] = []): EnvValue[] =>
  values
    .filter((v) => v?.key)
    .map((v) => ({ key: v.key, value: typeof v.value === 'string' ? v.value : JSON.stringify(v.value ?? ''), enabled: v.enabled !== false, type: v.type }))

function applyOverrides(values: EnvValue[], pairs: string[] = []) {
  for (const p of pairs) {
    const i = p.indexOf('=')
    if (i < 1) throw new UsageError(`Formato inválido "${p}": use chave=valor`)
    const key = p.slice(0, i)
    const value = p.slice(i + 1)
    const cur = values.find((v) => v.key === key)
    if (cur) Object.assign(cur, { value, enabled: true })
    else values.push({ key, value, enabled: true })
  }
  return values
}

function loadData(file: string): Record<string, any>[] {
  const text = fs.readFileSync(file, 'utf8')
  const rows = file.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCsv(text)
  if (!Array.isArray(rows)) throw new UsageError('O arquivo de dados JSON precisa ser uma lista de objetos')
  return rows
}

/** Caminho "Pasta / Sub / Requisição" de cada item, para a saída. */
function pathIndex(items: PMItem[], prefix: string[] = [], out = new Map<string, string>()) {
  for (const it of items) {
    if (it.item) pathIndex(it.item, [...prefix, it.name], out)
    else out.set(it.id, [...prefix, it.name].join(' / '))
  }
  return out
}

function findFolder(items: PMItem[], ref: string): PMItem | undefined {
  for (const it of items) {
    if (it.item && (it.id === ref || it.name.toLowerCase() === ref.toLowerCase())) return it
    const sub = it.item && findFolder(it.item, ref)
    if (sub) return sub
  }
}

// ---------------- comandos ----------------

const fmtBytes = (n = 0) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}kB` : `${(n / 1048576).toFixed(1)}MB`)
const fmtMs = (n = 0) => (n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(2)}s`)

async function cmdRun(a: Args): Promise<number> {
  const ref = a._[1]
  if (!ref) throw new UsageError('Informe a coleção: postwoman run <arquivo-ou-nome>')
  const ws = workspaceDir(a)
  let collection = await loadCollection(ref, ws)

  // várias --folder: roda cada uma como uma coleção só com aquela pasta
  if (a.folder?.length) {
    const folders = (a.folder as string[]).map((f) => {
      const found = findFolder(collection.item, f)
      if (!found) throw new UsageError(`Pasta "${f}" não existe na coleção ${collection.info.name}`)
      return found
    })
    collection = { ...collection, item: folders }
  }

  const environment = a.environment ? loadEnvironment(a.environment, ws) : a['env-var'] ? { id: randomUUID(), name: 'cli', values: [] } : null
  if (environment) applyOverrides(environment.values, a['env-var'])
  const globals = applyOverrides(a.globals ? normalizeValues(readJson(path.resolve(a.globals)).values) : [], a['global-var'])
  const data = a['iteration-data'] ? loadData(path.resolve(a['iteration-data'])) : undefined

  const network: NetworkSettings = {
    ...DEFAULT_NETWORK,
    strictSSL: !a.insecure,
    followRedirects: !a['ignore-redirects'],
    timeoutMs: Number(a['timeout-request']) || 0,
    caCertPath: a['ssl-extra-ca-certs'] ? path.resolve(a['ssl-extra-ca-certs']) : '',
    proxy: a.proxy ? { ...DEFAULT_NETWORK.proxy, mode: 'custom', url: a.proxy, bypass: '' } : { ...DEFAULT_NETWORK.proxy, mode: 'system' },
    clientCerts:
      a['ssl-client-cert'] || a['ssl-client-pfx']
        ? [
            {
              id: 'cli',
              host: '*',
              certPath: a['ssl-client-cert'] ? path.resolve(a['ssl-client-cert']) : '',
              keyPath: a['ssl-client-key'] ? path.resolve(a['ssl-client-key']) : '',
              pfxPath: a['ssl-client-pfx'] ? path.resolve(a['ssl-client-pfx']) : '',
              passphrase: a['ssl-client-passphrase'] || ''
            }
          ]
        : []
  }

  const reporters = String(a.reporters || 'cli')
    .split(',')
    .map((r) => r.trim())
  const silent = a.silent || !reporters.includes('cli')
  const log = (...s: string[]) => !silent && console.log(...s)
  const paths = pathIndex(collection.item)
  const report: RunReport = { collection: collection.info.name, environment: environment?.name, startedAt: new Date().toISOString(), items: [], console: [] }
  const started = Date.now()

  log(`\n${c.bold('Postwoman')} ${c.gray(VERSION)} · ${c.bold(collection.info.name)}${environment ? c.gray(` · ambiente ${environment.name}`) : ''}`)

  let lastIteration = -1
  // o console de um script chega antes do fim do item: guarda e imprime junto com ele
  let pendingConsole: string[] = []
  let run: { abort(): void } | null = null
  const onSigint = () => {
    log(c.yellow('\nInterrompido.'))
    run?.abort()
  }
  process.once('SIGINT', onSigint)

  const done = await new Promise<Extract<RunnerEvent, { type: 'done' }>>((resolve) => {
    runCollection(
      { userAgent: `Postwoman-CLI/${VERSION}`, network, cookieJar: new CookieJar(undefined, { looseMode: true }), onRun: (r) => (run = r) },
      {
        runId: 'cli',
        collection,
        environment,
        globals,
        iterations: Math.max(1, Number(a['iteration-count']) || 1),
        delayMs: Number(a['delay-request']) || 0,
        data,
        stopOnError: !!a.bail,
        persistVariables: true
      },
      (e) => {
        if (e.type === 'console') {
          report.console.push(e.entry)
          pendingConsole.push(c.gray(`  │ ${e.entry.level === 'log' ? '' : `[${e.entry.level}] `}${e.entry.messages.join(' ')}`))
        }
        if (e.type === 'item') {
          if (e.iteration !== lastIteration && (data?.length || 0) + (Number(a['iteration-count']) || 1) > 1) {
            lastIteration = e.iteration
            log(c.cyan(`\nIteração ${e.iteration + 1}`))
          }
          report.items.push({ ...e, path: paths.get(e.itemId) || e.name })
          log(`\n${c.gray('→')} ${paths.get(e.itemId) || e.name}`)
          const meta = e.error
            ? c.red(e.error)
            : `${(e.code || 0) < 400 ? c.green(`${e.code} ${e.status}`) : c.red(`${e.code} ${e.status}`)} ${c.gray(`${fmtBytes(e.size)} · ${fmtMs(e.time)}`)}`
          log(`  ${c.bold(e.method || '')} ${e.url || ''} ${c.gray('[')}${meta}${c.gray(']')}`)
          pendingConsole.forEach((l) => log(l))
          pendingConsole = []
          for (const t of e.tests) {
            if (t.skipped) log(`  ${c.yellow('-')} ${c.gray(t.name)} ${c.gray('(pulado)')}`)
            else if (t.passed) log(`  ${c.green('✓')} ${t.name}`)
            else log(`  ${c.red('✗')} ${t.name}${t.error ? `\n      ${c.red(t.error)}` : ''}`)
          }
        }
        if (e.type === 'done') {
          pendingConsole.forEach((l) => log(l))
          resolve(e)
        }
      }
    )
  })
  process.off('SIGINT', onSigint)

  report.finishedAt = new Date().toISOString()
  report.durationMs = Date.now() - started
  report.error = done.error
  report.environmentOut = done.environment
  const s = summarize(report)

  log('')
  log(`${c.bold('Requisições')}  ${s.requests} executadas, ${s.requestErrors ? c.red(`${s.requestErrors} com erro`) : c.green('0 com erro')}`)
  log(
    `${c.bold('Testes')}       ${s.tests} no total, ${s.failed ? c.red(`${s.failed} falharam`) : c.green(`${s.passed} passaram`)}${s.skipped ? c.gray(`, ${s.skipped} pulados`) : ''}`
  )
  log(`${c.bold('Tempo')}        ${fmtMs(report.durationMs)} no total, ${fmtMs(s.avgResponseMs)} de resposta em média`)
  if (done.error) log(c.red(`\nExecução interrompida: ${done.error}`))
  if (s.failures.length) {
    log(c.red(`\n${s.failures.length} falha${s.failures.length > 1 ? 's' : ''}:`))
    s.failures.forEach((f, i) => log(`  ${i + 1}. ${f.where}\n     ${c.red(f.message)}`))
  }
  log('')

  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
    fs.writeFileSync(file, content)
  }
  if (reporters.includes('json')) write(a['reporter-json-export'] || `postwoman-run-${Date.now()}.json`, JSON.stringify({ ...report, summary: s }, null, 2))
  if (reporters.includes('junit')) write(a['reporter-junit-export'] || `postwoman-run-${Date.now()}.xml`, junitReport(report))
  if (a['export-environment'] && done.environment)
    write(
      a['export-environment'],
      JSON.stringify({ id: environment?.id, name: environment?.name || 'cli', values: done.environment, _postman_variable_scope: 'environment' }, null, 2)
    )

  return s.failed || s.requestErrors || done.error ? 1 : 0
}

async function cmdMock(a: Args): Promise<number> {
  const ref = a._[1]
  if (!ref) throw new UsageError('Informe a coleção: postwoman mock <arquivo-ou-nome>')
  const collection = await loadCollection(ref, workspaceDir(a))
  const server = await startMockServer(collection, {
    port: a.port !== undefined ? Number(a.port) : 4010,
    host: a.host || '127.0.0.1',
    onRequest: (e) =>
      console.log(
        `${c.gray(new Date(e.at).toLocaleTimeString('pt-BR'))} ${c.bold(e.method)} ${e.path} ${e.code < 400 ? c.green(e.code) : c.red(e.code)} ${c.gray(e.example || '')}`
      )
  })
  console.log(
    `\n${c.bold('Mock')} de ${c.bold(collection.info.name)} em ${c.cyan(`http://${a.host || 'localhost'}:${server.port}`)} · ${server.routes()} exemplos`
  )
  console.log(c.gray('Ctrl+C para parar.\n'))
  await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()))
  await server.close()
  return 0
}

function cmdList(a: Args): number {
  const ws = workspaceDir(a)
  console.log(`${c.bold('Pasta de trabalho')} ${ws}\n`)
  console.log(c.bold('Coleções'))
  for (const f of listJson(path.join(ws, 'collections'))) {
    try {
      const j = readJson(f)
      let n = 0
      const count = (items: any[] = []) => items.forEach((i) => (i.item ? count(i.item) : n++))
      count(j.item)
      console.log(`  ${j.info?.name} ${c.gray(`· ${n} requisições · ${path.basename(f)}`)}`)
    } catch {
      console.log(`  ${c.red(path.basename(f))} ${c.gray('(inválido)')}`)
    }
  }
  console.log(`\n${c.bold('Ambientes')}`)
  for (const f of listJson(path.join(ws, 'environments'))) {
    try {
      console.log(`  ${readJson(f).name} ${c.gray(`· ${path.basename(f)}`)}`)
    } catch {
      console.log(`  ${c.red(path.basename(f))} ${c.gray('(inválido)')}`)
    }
  }
  return 0
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const a = parseArgs(argv)
    if (a['no-color']) useColor = false
    if (a.version) return (console.log(VERSION), 0)
    const cmd = a._[0]
    if (a.help || !cmd || cmd === 'help') return (console.log(HELP), cmd || a.help ? 0 : 2)
    if (cmd === 'run') return await cmdRun(a)
    if (cmd === 'mock') return await cmdMock(a)
    if (cmd === 'list' || cmd === 'ls') return cmdList(a)
    throw new UsageError(`Comando desconhecido: ${cmd}. Veja postwoman --help`)
  } catch (e: any) {
    console.error(c.red(e instanceof UsageError ? e.message : `Erro: ${e?.stack || e}`))
    return e instanceof UsageError ? 2 : 1
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().then((code) => process.exit(code))
}
