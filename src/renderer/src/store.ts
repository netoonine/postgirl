import { create } from 'zustand'
import type {
  ConsoleEntry,
  Environment,
  EnvValue,
  HistoryEntry,
  HttpResult,
  PMCollection,
  PMItem,
  Protocol,
  Settings
} from '@shared/types'
import { api } from './api'
import { clone, containsId, findItem, newCollection, newFolder, newRequestItem, reId, uid } from './util'

export type TabKind = 'request' | 'collection' | 'folder' | 'environment' | 'globals' | 'runner'

export interface Tab {
  id: string
  kind: TabKind
  collectionId?: string
  itemId?: string
  envId?: string
  draft?: PMItem
  dirty?: boolean
  result?: HttpResult
  loading?: boolean
  runId?: string
}

export interface LogEntry {
  id: string
  at: number
  kind: 'request' | 'console'
  level?: string
  messages?: string[]
  method?: string
  url?: string
  code?: number
  status?: string
  time?: number
  error?: string
  result?: HttpResult
}

export interface ModalState {
  type: string
  props?: any
  resolve?: (v: any) => void
}

interface State {
  ready: boolean
  workspacePath: string
  settings: Settings
  collections: PMCollection[]
  environments: Environment[]
  globals: EnvValue[]
  history: HistoryEntry[]
  activeEnvId: string | null
  tabs: Tab[]
  activeTabId: string | null
  expanded: Record<string, boolean>
  sidebarOpen: boolean
  sidebarSection: 'collections' | 'environments' | 'history'
  consoleOpen: boolean
  logs: LogEntry[]
  modal: ModalState | null
}

const UI_KEY = 'postgirl.ui'

const initial: State = {
  ready: false,
  workspacePath: '',
  settings: {
    workspacePath: '',
    followRedirects: true,
    strictSSL: false,
    timeoutMs: 0,
    maxResponseMB: 50,
    theme: 'system',
    layout: 'vertical'
  },
  collections: [],
  environments: [],
  globals: [],
  history: [],
  activeEnvId: null,
  tabs: [],
  activeTabId: null,
  expanded: {},
  sidebarOpen: true,
  sidebarSection: 'collections',
  consoleOpen: false,
  logs: [],
  modal: null
}

export const useStore = create<State>(() => initial)
const get = useStore.getState
const set = useStore.setState

// ---------------- persistência de UI (abas abertas etc.) ----------------

function saveUi() {
  const s = get()
  try {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        workspacePath: s.workspacePath,
        activeEnvId: s.activeEnvId,
        activeTabId: s.activeTabId,
        expanded: s.expanded,
        sidebarOpen: s.sidebarOpen,
        sidebarSection: s.sidebarSection,
        tabs: s.tabs.map(({ result, loading, runId, ...t }) => t)
      })
    )
  } catch {
    /* sem localStorage: a sessão só não é restaurada */
  }
}

let uiTimer: any
useStore.subscribe(() => {
  clearTimeout(uiTimer)
  uiTimer = setTimeout(saveUi, 500)
})

function restoreUi() {
  try {
    const ui = JSON.parse(localStorage.getItem(UI_KEY) || 'null')
    if (!ui || ui.workspacePath !== get().workspacePath) return
    const s = get()
    const tabs: Tab[] = (ui.tabs || []).filter((t: Tab) => {
      if (t.kind === 'environment') return s.environments.some((e) => e.id === t.envId)
      if (t.collectionId && !t.dirty) {
        const col = s.collections.find((c) => c.info._postman_id === t.collectionId)
        if (!col) return false
        if (t.itemId && !findItem(col.item, t.itemId)) return false
      }
      return true
    })
    // abas sem alterações recarregam do disco (o arquivo pode ter mudado, ex. git pull)
    for (const t of tabs) {
      if (t.kind === 'request' && t.collectionId && !t.dirty) {
        const col = s.collections.find((c) => c.info._postman_id === t.collectionId)!
        t.draft = clone(findItem(col.item, t.itemId!)!.item)
      }
    }
    set({
      tabs,
      activeTabId: tabs.some((t) => t.id === ui.activeTabId) ? ui.activeTabId : tabs[0]?.id ?? null,
      activeEnvId: s.environments.some((e) => e.id === ui.activeEnvId) ? ui.activeEnvId : null,
      expanded: ui.expanded || {},
      sidebarOpen: ui.sidebarOpen ?? true,
      sidebarSection: ui.sidebarSection || 'collections'
    })
  } catch {
    /* estado de UI corrompido: começa limpo */
  }
}

// ---------------- workspace ----------------

export async function init() {
  const ws = await api.loadWorkspace()
  set({
    ready: true,
    workspacePath: ws.path,
    settings: ws.settings,
    collections: ws.collections,
    environments: ws.environments,
    globals: ws.globals,
    history: ws.history,
    tabs: [],
    activeTabId: null
  })
  restoreUi()
  applyTheme()
}

export async function reloadWorkspace() {
  saveUi()
  await init()
}

export async function chooseWorkspace() {
  const ws = await api.chooseWorkspace()
  if (ws) await init()
}

export function applyTheme() {
  const t = get().settings.theme
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export async function updateSettings(s: Partial<Settings>) {
  const next = await api.saveSettings(s)
  set({ settings: next })
  applyTheme()
}

// ---------------- modais (promessas) ----------------

export function openModal<T = any>(type: string, props?: any): Promise<T> {
  return new Promise((resolve) => set({ modal: { type, props, resolve } }))
}

export function closeModal(value?: any) {
  const m = get().modal
  set({ modal: null })
  m?.resolve?.(value)
}

export const prompt = (title: string, value = '', label?: string) =>
  openModal<string | undefined>('prompt', { title, value, label })

export const confirmDialog = (title: string, message: string, danger = false, okLabel = 'Confirmar') =>
  openModal<boolean>('confirm', { title, message, danger, okLabel })

export const toast = (message: string, kind: 'info' | 'error' = 'info') =>
  window.dispatchEvent(new CustomEvent('postgirl-toast', { detail: { message, kind } }))

// ---------------- coleções ----------------

const saveTimers = new Map<string, any>()

function persistCollection(id: string, immediate = false) {
  clearTimeout(saveTimers.get(id))
  const run = () => {
    const c = getCollection(id)
    if (c) api.saveCollection(c).catch((e) => toast(`Erro ao salvar: ${e.message}`, 'error'))
  }
  if (immediate) run()
  else saveTimers.set(id, setTimeout(run, 400))
}

export const getCollection = (id?: string) => get().collections.find((c) => c.info._postman_id === id)

/** Aplica uma alteração numa cópia da coleção e salva no disco. */
export function updateCollection(id: string, fn: (c: PMCollection) => void, immediate = false) {
  const cur = getCollection(id)
  if (!cur) return
  const next = clone(cur)
  fn(next)
  set({ collections: get().collections.map((c) => (c.info._postman_id === id ? next : c)) })
  persistCollection(id, immediate)
}

export function addCollection(c: PMCollection, open = false) {
  set({
    collections: [...get().collections, c].sort((a, b) => a.info.name.localeCompare(b.info.name)),
    expanded: { ...get().expanded, [c.info._postman_id]: true }
  })
  persistCollection(c.info._postman_id, true)
  if (open) openCollectionTab(c.info._postman_id)
}

export async function createCollection() {
  const name = await prompt('Nova coleção', 'Nova coleção', 'Nome')
  if (!name) return
  addCollection(newCollection(name), true)
}

export async function deleteCollection(id: string) {
  const c = getCollection(id)
  if (!c || !(await confirmDialog('Excluir coleção', `Excluir "${c.info.name}" e todas as requisições dela? O arquivo será apagado da pasta de trabalho.`, true, 'Excluir')))
    return
  await api.deleteCollection(id)
  set({
    collections: get().collections.filter((x) => x.info._postman_id !== id),
    tabs: get().tabs.filter((t) => t.collectionId !== id || t.dirty)
  })
  fixActiveTab()
}

export function duplicateCollection(id: string) {
  const c = getCollection(id)
  if (!c) return
  const copy = clone(c)
  copy.info = { ...copy.info, _postman_id: uid(), name: `${c.info.name} (cópia)` }
  copy.item = copy.item.map(reId)
  addCollection(copy)
}

export function exportCollection(id: string) {
  const c = getCollection(id)
  if (c) api.saveFile(`${c.info.name}.postman_collection.json`, JSON.stringify(c, null, 2))
}

// ---------------- itens (requisições e pastas) ----------------

export function addItem(collectionId: string, parentId: string | null, item: PMItem) {
  updateCollection(
    collectionId,
    (c) => {
      const parent = parentId ? findItem(c.item, parentId)?.item : null
      if (parent) (parent.item ||= []).push(item)
      else c.item.push(item)
    },
    true
  )
  set({ expanded: { ...get().expanded, [collectionId]: true, ...(parentId ? { [parentId]: true } : {}) } })
}

export async function addRequest(collectionId: string, parentId: string | null, protocol: Protocol = 'http') {
  const item = newItemFor(protocol)
  addItem(collectionId, parentId, item)
  openItem(collectionId, item.id)
}

export async function addFolder(collectionId: string, parentId: string | null) {
  const name = await prompt('Nova pasta', 'Nova pasta', 'Nome')
  if (!name) return
  addItem(collectionId, parentId, newFolder(name))
}

export async function renameItem(collectionId: string, itemId: string) {
  const it = findItem(getCollection(collectionId)?.item || [], itemId)?.item
  if (!it) return
  const name = await prompt('Renomear', it.name, 'Nome')
  if (!name || name === it.name) return
  updateCollection(collectionId, (c) => (findItem(c.item, itemId)!.item.name = name), true)
  // o rascunho aberto acompanha o novo nome
  set({
    tabs: get().tabs.map((t) => (t.itemId === itemId && t.draft ? { ...t, draft: { ...t.draft, name } } : t))
  })
}

export async function renameCollection(id: string) {
  const c = getCollection(id)
  if (!c) return
  const name = await prompt('Renomear coleção', c.info.name, 'Nome')
  if (!name || name === c.info.name) return
  updateCollection(id, (x) => (x.info.name = name), true)
}

export function duplicateItem(collectionId: string, itemId: string) {
  updateCollection(
    collectionId,
    (c) => {
      const f = findItem(c.item, itemId)
      if (!f) return
      const copy = reId(f.item)
      copy.name = `${f.item.name} (cópia)`
      f.siblings.splice(f.index + 1, 0, copy)
    },
    true
  )
}

export async function deleteItem(collectionId: string, itemId: string) {
  const it = findItem(getCollection(collectionId)?.item || [], itemId)?.item
  if (!it) return
  const what = it.item ? `a pasta "${it.name}" e tudo dentro dela` : `"${it.name}"`
  if (!(await confirmDialog('Excluir', `Excluir ${what}?`, true, 'Excluir'))) return
  updateCollection(
    collectionId,
    (c) => {
      const f = findItem(c.item, itemId)
      if (f) f.siblings.splice(f.index, 1)
    },
    true
  )
  set({ tabs: get().tabs.filter((t) => !(t.collectionId === collectionId && t.itemId && containsId(it, t.itemId) && !t.dirty)) })
  fixActiveTab()
}

/** Arrastar e soltar: move entre pastas e entre coleções. */
export function moveItem(
  srcCol: string,
  itemId: string,
  dstCol: string,
  targetId: string | null,
  where: 'inside' | 'before' | 'after'
) {
  if (itemId === targetId) return
  const src = getCollection(srcCol)
  const found = src && findItem(src.item, itemId)
  if (!found) return
  if (targetId && containsId(found.item, targetId)) return // pasta dentro dela mesma
  const moving = clone(found.item)

  updateCollection(srcCol, (c) => {
    const f = findItem(c.item, itemId)!
    f.siblings.splice(f.index, 1)
  })
  updateCollection(
    dstCol,
    (c) => {
      if (!targetId) return c.item.push(moving)
      const t = findItem(c.item, targetId)
      if (!t) return c.item.push(moving)
      if (where === 'inside') (t.item.item ||= []).push(moving)
      else t.siblings.splice(where === 'before' ? t.index : t.index + 1, 0, moving)
    },
    true
  )
  persistCollection(srcCol, true)
  if (srcCol !== dstCol) {
    set({ tabs: get().tabs.map((t) => (t.collectionId === srcCol && t.itemId && containsId(moving, t.itemId) ? { ...t, collectionId: dstCol } : t)) })
  }
}

// ---------------- ambientes e globais ----------------

export const getEnvironment = (id?: string | null) => get().environments.find((e) => e.id === id)

export function updateEnvironment(id: string, fn: (e: Environment) => void) {
  const cur = getEnvironment(id)
  if (!cur) return
  const next = clone(cur)
  fn(next)
  set({ environments: get().environments.map((e) => (e.id === id ? next : e)) })
  clearTimeout(saveTimers.get(`env:${id}`))
  saveTimers.set(
    `env:${id}`,
    setTimeout(() => api.saveEnvironment(getEnvironment(id)!), 400)
  )
}

export function addEnvironment(env: Environment, open = false) {
  set({ environments: [...get().environments, env].sort((a, b) => a.name.localeCompare(b.name)) })
  api.saveEnvironment(env)
  if (open) openEnvironmentTab(env.id)
}

export async function createEnvironment() {
  const name = await prompt('Novo ambiente', 'Novo ambiente', 'Nome')
  if (!name) return
  addEnvironment({ id: uid(), name, values: [] }, true)
}

export async function deleteEnvironment(id: string) {
  const e = getEnvironment(id)
  if (!e || !(await confirmDialog('Excluir ambiente', `Excluir o ambiente "${e.name}"?`, true, 'Excluir'))) return
  await api.deleteEnvironment(id)
  set({
    environments: get().environments.filter((x) => x.id !== id),
    activeEnvId: get().activeEnvId === id ? null : get().activeEnvId,
    tabs: get().tabs.filter((t) => t.envId !== id)
  })
  fixActiveTab()
}

export function duplicateEnvironment(id: string) {
  const e = getEnvironment(id)
  if (e) addEnvironment({ ...clone(e), id: uid(), name: `${e.name} (cópia)` })
}

export function exportEnvironment(id: string) {
  const e = getEnvironment(id)
  if (e)
    api.saveFile(
      `${e.name}.postman_environment.json`,
      JSON.stringify({ id: e.id, name: e.name, values: e.values, _postman_variable_scope: 'environment' }, null, 2)
    )
}

export function setGlobals(values: EnvValue[]) {
  set({ globals: values })
  clearTimeout(saveTimers.get('globals'))
  saveTimers.set(
    'globals',
    setTimeout(() => api.saveGlobals(get().globals), 400)
  )
}

export const setActiveEnv = (id: string | null) => set({ activeEnvId: id })

// ---------------- abas ----------------

function fixActiveTab() {
  const s = get()
  if (!s.tabs.some((t) => t.id === s.activeTabId)) set({ activeTabId: s.tabs[s.tabs.length - 1]?.id ?? null })
}

function pushTab(tab: Tab) {
  set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
}

export const setActiveTab = (id: string) => set({ activeTabId: id })

export function newItemFor(protocol: Protocol): PMItem {
  if (protocol === 'http') return newRequestItem()
  const defaults: Record<string, any> = {
    websocket: { url: 'wss://', headers: [], message: '', protocols: '' },
    socketio: { url: 'http://localhost:3000', path: '/socket.io', headers: [], event: 'message', message: '', auth: '', events: [] },
    mqtt: { url: 'mqtt://localhost:1883', clientId: '', username: '', password: '', subscriptions: [{ topic: '#', qos: 0 }], topic: '', qos: 0, retain: false, message: '', version: 4 },
    grpc: { url: 'localhost:50051', tls: false, source: 'reflection', protoPath: '', method: '', message: '{}', metadata: [], deadlineMs: 0 }
  }
  const names: Record<string, string> = { websocket: 'WebSocket', socketio: 'Socket.IO', mqtt: 'MQTT', grpc: 'gRPC' }
  return {
    ...newRequestItem(`Nova ${names[protocol]}`, { method: 'GET', url: { raw: defaults[protocol].url } }),
    postgirl: { protocol, config: defaults[protocol] }
  } as PMItem
}

export function openNewRequest(protocol: Protocol = 'http', preset?: Partial<PMItem>) {
  const draft = { ...newItemFor(protocol), name: 'Sem título', ...preset }
  pushTab({ id: uid(), kind: 'request', draft, dirty: false })
}

export function openItem(collectionId: string, itemId: string) {
  const existing = get().tabs.find((t) => t.collectionId === collectionId && t.itemId === itemId)
  if (existing) return set({ activeTabId: existing.id })
  const col = getCollection(collectionId)
  const f = col && findItem(col.item, itemId)
  if (!f) return
  if (f.item.item) return openFolderTab(collectionId, itemId)
  pushTab({ id: uid(), kind: 'request', collectionId, itemId, draft: clone(f.item) })
}

export function openCollectionTab(collectionId: string) {
  const existing = get().tabs.find((t) => t.kind === 'collection' && t.collectionId === collectionId)
  if (existing) return set({ activeTabId: existing.id })
  pushTab({ id: uid(), kind: 'collection', collectionId })
}

export function openFolderTab(collectionId: string, itemId: string) {
  const existing = get().tabs.find((t) => t.kind === 'folder' && t.itemId === itemId)
  if (existing) return set({ activeTabId: existing.id })
  pushTab({ id: uid(), kind: 'folder', collectionId, itemId })
}

export function openEnvironmentTab(envId: string) {
  const existing = get().tabs.find((t) => t.kind === 'environment' && t.envId === envId)
  if (existing) return set({ activeTabId: existing.id })
  pushTab({ id: uid(), kind: 'environment', envId })
}

export function openGlobalsTab() {
  const existing = get().tabs.find((t) => t.kind === 'globals')
  if (existing) return set({ activeTabId: existing.id })
  pushTab({ id: uid(), kind: 'globals' })
}

export function openRunner(collectionId: string, folderId?: string) {
  pushTab({ id: uid(), kind: 'runner', collectionId, itemId: folderId })
}

export function updateTab(id: string, patch: Partial<Tab>) {
  set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
}

export function updateDraft(tabId: string, fn: (d: PMItem) => void) {
  const t = get().tabs.find((x) => x.id === tabId)
  if (!t?.draft) return
  const next = clone(t.draft)
  fn(next)
  updateTab(tabId, { draft: next, dirty: true })
}

export async function closeTab(id: string) {
  const t = get().tabs.find((x) => x.id === id)
  if (!t) return
  if (t.dirty) {
    const r = await openModal<'save' | 'discard' | undefined>('unsaved', { name: t.draft?.name })
    if (!r) return
    if (r === 'save' && !(await saveTab(id))) return
  }
  if (t.runId) api.cancel(t.runId)
  if (t.draft?.postgirl) api.rt.disconnect(t.id)
  const idx = get().tabs.findIndex((x) => x.id === id)
  const tabs = get().tabs.filter((x) => x.id !== id)
  set({ tabs, activeTabId: get().activeTabId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : get().activeTabId })
}

export function closeOtherTabs(id: string) {
  set({ tabs: get().tabs.filter((t) => t.id === id || t.dirty), activeTabId: id })
}

/** Salva o rascunho na coleção; sem coleção, pergunta onde salvar. Retorna false se cancelado. */
export async function saveTab(id: string): Promise<boolean> {
  const t = get().tabs.find((x) => x.id === id)
  if (!t?.draft) return true
  const col = getCollection(t.collectionId)
  if (col && t.itemId && findItem(col.item, t.itemId)) {
    const draft = clone(t.draft)
    updateCollection(
      col.info._postman_id,
      (c) => {
        const f = findItem(c.item, t.itemId!)!
        f.siblings[f.index] = draft
      },
      true
    )
    updateTab(id, { dirty: false })
    return true
  }
  const target = await openModal<{ collectionId: string; parentId: string | null; name: string } | undefined>('save-request', {
    name: t.draft.name === 'Sem título' ? '' : t.draft.name
  })
  if (!target) return false
  const item = { ...clone(t.draft), id: uid(), name: target.name }
  addItem(target.collectionId, target.parentId, item)
  updateTab(id, { collectionId: target.collectionId, itemId: item.id, draft: item, dirty: false })
  return true
}

// ---------------- envio ----------------

const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export async function sendTab(id: string) {
  const t = get().tabs.find((x) => x.id === id)
  if (!t?.draft || t.loading) return
  const draft = clone(t.draft)
  const col = getCollection(t.collectionId)
  let collection: PMCollection
  if (col && t.itemId && findItem(col.item, t.itemId)) {
    collection = clone(col)
    const f = findItem(collection.item, t.itemId)!
    f.siblings[f.index] = { ...draft, id: t.itemId }
  } else {
    collection = { ...newCollection('Avulsa'), item: [draft] }
  }
  const itemId = t.itemId && col ? t.itemId : draft.id
  const env = getEnvironment(get().activeEnvId) || null
  const runId = uid()
  updateTab(id, { loading: true, runId })

  let res: HttpResult
  try {
    res = await api.send({ runId, collection, itemId, environment: env, globals: get().globals })
  } catch (e: any) {
    res = { ok: false, error: e.message || String(e), tests: [], console: [] }
  }
  // aba fechada ou cancelada durante o envio
  const still = get().tabs.find((x) => x.id === id)
  if (still && still.runId === runId) updateTab(id, { loading: false, runId: undefined, result: res })

  if (env && res.environment && !sameJSON(env.values, res.environment)) updateEnvironment(env.id, (e) => (e.values = res.environment!))
  if (res.globals && !sameJSON(get().globals, res.globals)) setGlobals(res.globals)
  if (col && res.collectionVariables && !sameJSON(col.variable || [], res.collectionVariables))
    updateCollection(col.info._postman_id, (c) => (c.variable = res.collectionVariables))

  const logs: LogEntry[] = res.console.map((c: ConsoleEntry) => ({ id: uid(), at: c.at, kind: 'console', level: c.level, messages: c.messages }))
  logs.push({
    id: uid(),
    at: Date.now(),
    kind: 'request',
    method: res.sent?.method || draft.request?.method,
    url: res.sent?.url || draft.request?.url.raw,
    code: res.response?.code,
    status: res.response?.status,
    time: res.response?.time,
    error: res.error,
    result: res
  })
  addLogs(logs)

  if (draft.request) {
    const history = await api.addHistory({
      id: uid(),
      at: Date.now(),
      method: draft.request.method,
      url: res.sent?.url || draft.request.url.raw,
      code: res.response?.code,
      request: draft.request
    })
    set({ history })
  }
}

export function cancelTab(id: string) {
  const t = get().tabs.find((x) => x.id === id)
  if (t?.runId) api.cancel(t.runId)
  updateTab(id, { loading: false, runId: undefined, result: { ok: false, error: 'Requisição cancelada', tests: [], console: [] } })
}

// ---------------- console ----------------

export function addLogs(entries: LogEntry[]) {
  set({ logs: [...get().logs, ...entries].slice(-1000) })
}

export const clearLogs = () => set({ logs: [] })
export const toggleConsole = () => set({ consoleOpen: !get().consoleOpen })
export const toggleSidebar = () => set({ sidebarOpen: !get().sidebarOpen })
export const toggleExpanded = (id: string) => set({ expanded: { ...get().expanded, [id]: !get().expanded[id] } })

export async function clearHistory() {
  if (!(await confirmDialog('Limpar histórico', 'Apagar todo o histórico de requisições?', true, 'Limpar'))) return
  await api.clearHistory()
  set({ history: [] })
}

export function openFromHistory(h: HistoryEntry) {
  openNewRequest('http', { name: h.url.replace(/^https?:\/\//, '').slice(0, 60), request: clone(h.request) })
}
