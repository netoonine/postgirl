import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Environment, EnvValue, HistoryEntry, PMCollection, Settings, Workspace } from '@shared/types'
import { DEFAULT_NETWORK } from '@shared/types'
import { normalizeCollection, stripInherit } from '../core/collection'
import * as secrets from './secrets'

// Layout da pasta de trabalho (versionável com git):
//   collections/<nome>-<id>.postman_collection.json
//   environments/<nome>-<id>.postman_environment.json
//   globals.postman_globals.json
//   cookies.json, history.json
// Valores "secreto" de ambientes/globais não vão para esses arquivos: ficam no cofre (secrets.ts).

const HISTORY_LIMIT = 300

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

const defaultSettings = (): Settings => ({
  ...DEFAULT_NETWORK,
  workspacePath: process.env.POSTGIRL_USER_DATA ? path.join(process.env.POSTGIRL_USER_DATA, 'workspace') : path.join(os.homedir(), 'Postgirl'),
  theme: 'system',
  layout: 'vertical'
})

function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

// o que o próprio app gravou/apagou, para o watcher não tratar como alteração externa
const ownWrites = new Map<string, string>()
const ownDeletes = new Map<string, number>()

function writeJSON(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = JSON.stringify(data, null, 2) + '\n'
  const tmp = `${file}.${process.pid}.tmp`
  ownWrites.set(file, text)
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

function removeFile(file: string) {
  ownDeletes.set(file, Date.now())
  ownWrites.delete(file)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

/** true quando o arquivo está exatamente como o app o deixou */
export function isOwnChange(file: string): boolean {
  if (!fs.existsSync(file)) return Date.now() - (ownDeletes.get(file) || 0) < 5000
  try {
    return ownWrites.get(file) === fs.readFileSync(file, 'utf8')
  } catch {
    return false
  }
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 50) || 'sem-nome'

let settings: Settings = defaultSettings()
// id -> caminho do arquivo, para remover o arquivo antigo quando o nome muda
const collectionFiles = new Map<string, string>()
const environmentFiles = new Map<string, string>()

const dir = (...p: string[]) => path.join(settings.workspacePath, ...p)

export function getSettings(): Settings {
  return settings
}

export function saveSettings(next: Partial<Settings>): Settings {
  settings = { ...settings, ...next }
  writeJSON(settingsFile(), settings)
  return settings
}

export { normalizeCollection }

const globalsScope = () => `globals:${settings.workspacePath}`

/** Preenche os valores secretos a partir do cofre. */
function withSecrets(values: EnvValue[] = [], scope: string): EnvValue[] {
  const vault = secrets.getScope(scope)
  return values.map((v) => (v.type === 'secret' && vault[v.key] !== undefined ? { ...v, value: vault[v.key] } : v))
}

/** Separa os segredos (vão para o cofre) do que vai para o arquivo. */
function splitSecrets(values: EnvValue[], scope: string): EnvValue[] {
  const vault: Record<string, string> = {}
  const out = values.map((v) => {
    if (v.type !== 'secret' || !v.key) return v
    vault[v.key] = v.value
    return { ...v, value: '' }
  })
  secrets.setScope(scope, vault)
  return out
}

export function loadWorkspace(): Workspace {
  const saved = readJSON<Partial<Settings>>(settingsFile(), {})
  settings = { ...defaultSettings(), ...saved, proxy: { ...DEFAULT_NETWORK.proxy, ...saved.proxy } }
  fs.mkdirSync(dir('collections'), { recursive: true })
  fs.mkdirSync(dir('environments'), { recursive: true })

  collectionFiles.clear()
  environmentFiles.clear()

  const collections: PMCollection[] = []
  for (const f of fs.readdirSync(dir('collections'))) {
    if (!f.endsWith('.json')) continue
    const file = dir('collections', f)
    const c = readJSON<PMCollection | null>(file, null)
    if (!c?.info) continue
    normalizeCollection(c)
    collectionFiles.set(c.info._postman_id, file)
    collections.push(c)
  }
  collections.sort((a, b) => a.info.name.localeCompare(b.info.name))

  const environments: Environment[] = []
  for (const f of fs.readdirSync(dir('environments'))) {
    if (!f.endsWith('.json')) continue
    const file = dir('environments', f)
    const e = readJSON<any>(file, null)
    if (!e) continue
    const id = e.id || randomUUID()
    const env: Environment = { id, name: e.name || 'Ambiente', values: withSecrets(e.values, `env:${id}`) }
    environmentFiles.set(env.id, file)
    environments.push(env)
  }
  environments.sort((a, b) => a.name.localeCompare(b.name))

  const globals = withSecrets(readJSON<any>(dir('globals.postman_globals.json'), { values: [] }).values || [], globalsScope())
  const history = readJSON<HistoryEntry[]>(dir('history.json'), [])

  return { path: settings.workspacePath, collections, environments, globals, history, settings }
}

export function saveCollection(c: PMCollection) {
  normalizeCollection(c)
  stripInherit(c.item)
  if (c.auth?.type === 'inherit') delete c.auth
  const id = c.info._postman_id
  const file = dir('collections', `${slug(c.info.name)}-${id.slice(0, 8)}.postman_collection.json`)
  const old = collectionFiles.get(id)
  writeJSON(file, c)
  if (old && old !== file) removeFile(old)
  collectionFiles.set(id, file)
}

export function deleteCollection(id: string) {
  const file = collectionFiles.get(id)
  if (file) removeFile(file)
  collectionFiles.delete(id)
}

export function saveEnvironment(e: Environment) {
  const file = dir('environments', `${slug(e.name)}-${e.id.slice(0, 8)}.postman_environment.json`)
  const old = environmentFiles.get(e.id)
  writeJSON(file, { id: e.id, name: e.name, values: splitSecrets(e.values, `env:${e.id}`), _postman_variable_scope: 'environment' })
  if (old && old !== file) removeFile(old)
  environmentFiles.set(e.id, file)
}

export function deleteEnvironment(id: string) {
  const file = environmentFiles.get(id)
  if (file) removeFile(file)
  environmentFiles.delete(id)
  secrets.deleteScope(`env:${id}`)
}

export function saveGlobals(values: EnvValue[]) {
  writeJSON(dir('globals.postman_globals.json'), {
    id: 'globals',
    name: 'Globals',
    values: splitSecrets(values, globalsScope()),
    _postman_variable_scope: 'globals'
  })
}

export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const list = readJSON<HistoryEntry[]>(dir('history.json'), [])
  list.unshift(entry)
  list.length = Math.min(list.length, HISTORY_LIMIT)
  writeJSON(dir('history.json'), list)
  return list
}

export function clearHistory() {
  writeJSON(dir('history.json'), [])
}

export const cookieFile = () => dir('cookies.json')
export { readJSON, writeJSON }
