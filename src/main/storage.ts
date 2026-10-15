import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Environment, EnvValue, HistoryEntry, PMCollection, PMItem, Settings, Workspace } from '@shared/types'
import { COLLECTION_SCHEMA } from '@shared/types'

// Layout da pasta de trabalho (versionável com git):
//   collections/<nome>-<id>.postman_collection.json
//   environments/<nome>-<id>.postman_environment.json
//   globals.postman_globals.json
//   cookies.json, history.json

const HISTORY_LIMIT = 300

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

const defaultSettings = (): Settings => ({
  workspacePath: process.env.RELAY_USER_DATA ? path.join(process.env.RELAY_USER_DATA, 'workspace') : path.join(os.homedir(), 'Relay'),
  followRedirects: true,
  strictSSL: false,
  timeoutMs: 0,
  maxResponseMB: 50,
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

function writeJSON(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
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

/** Garante ids em todos os itens: o Relay identifica requisições e pastas por id. */
function ensureIds(items: PMItem[] = []) {
  for (const it of items) {
    if (!it.id) it.id = randomUUID()
    if (it.item) ensureIds(it.item)
  }
}

export function normalizeCollection(c: PMCollection): PMCollection {
  c.info = c.info || ({} as PMCollection['info'])
  c.info._postman_id = c.info._postman_id || randomUUID()
  c.info.name = c.info.name || 'Nova coleção'
  c.info.schema = COLLECTION_SCHEMA
  c.item = c.item || []
  ensureIds(c.item)
  return c
}

export function loadWorkspace(): Workspace {
  settings = { ...defaultSettings(), ...readJSON<Partial<Settings>>(settingsFile(), {}) }
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
    const env: Environment = { id: e.id || randomUUID(), name: e.name || 'Ambiente', values: e.values || [] }
    environmentFiles.set(env.id, file)
    environments.push(env)
  }
  environments.sort((a, b) => a.name.localeCompare(b.name))

  const globals = readJSON<any>(dir('globals.postman_globals.json'), { values: [] }).values || []
  const history = readJSON<HistoryEntry[]>(dir('history.json'), [])

  return { path: settings.workspacePath, collections, environments, globals, history, settings }
}

/** No schema v2.1, "herdar do pai" é a ausência do campo auth. */
function stripInherit(items: PMItem[] = []) {
  for (const it of items) {
    if (it.auth?.type === 'inherit') delete it.auth
    if (it.request?.auth?.type === 'inherit') delete it.request.auth
    if (it.item) stripInherit(it.item)
  }
}

export function saveCollection(c: PMCollection) {
  normalizeCollection(c)
  stripInherit(c.item)
  if (c.auth?.type === 'inherit') delete c.auth
  const id = c.info._postman_id
  const file = dir('collections', `${slug(c.info.name)}-${id.slice(0, 8)}.postman_collection.json`)
  const old = collectionFiles.get(id)
  writeJSON(file, c)
  if (old && old !== file && fs.existsSync(old)) fs.unlinkSync(old)
  collectionFiles.set(id, file)
}

export function deleteCollection(id: string) {
  const file = collectionFiles.get(id)
  if (file && fs.existsSync(file)) fs.unlinkSync(file)
  collectionFiles.delete(id)
}

export function saveEnvironment(e: Environment) {
  const file = dir('environments', `${slug(e.name)}-${e.id.slice(0, 8)}.postman_environment.json`)
  const old = environmentFiles.get(e.id)
  writeJSON(file, { id: e.id, name: e.name, values: e.values, _postman_variable_scope: 'environment' })
  if (old && old !== file && fs.existsSync(old)) fs.unlinkSync(old)
  environmentFiles.set(e.id, file)
}

export function deleteEnvironment(id: string) {
  const file = environmentFiles.get(id)
  if (file && fs.existsSync(file)) fs.unlinkSync(file)
  environmentFiles.delete(id)
}

export function saveGlobals(values: EnvValue[]) {
  writeJSON(dir('globals.postman_globals.json'), {
    id: 'globals',
    name: 'Globals',
    values,
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
