import type { EnvValue, KV, PMAuth, PMCollection, PMEvent, PMItem, PMRequest, PMUrl } from '@shared/types'
import { COLLECTION_SCHEMA } from '@shared/types'

export const uid = () => crypto.randomUUID()
export const clone = <T>(v: T): T => structuredClone(v)

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const methodColor = (m = 'GET') =>
  ({
    GET: 'var(--m-get)',
    POST: 'var(--m-post)',
    PUT: 'var(--m-put)',
    PATCH: 'var(--m-patch)',
    DELETE: 'var(--m-delete)',
    HEAD: 'var(--m-head)',
    OPTIONS: 'var(--m-options)'
  })[m.toUpperCase()] || 'var(--m-other)'

// ---------------- URL <-> query params ----------------

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** Separa a query string do raw sem estragar {{variaveis}} (não usamos URL() de propósito). */
export function splitRaw(raw: string): { base: string; query: string; hash: string } {
  const hashAt = raw.indexOf('#')
  const hash = hashAt >= 0 ? raw.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw
  const q = noHash.indexOf('?')
  return q >= 0 ? { base: noHash.slice(0, q), query: noHash.slice(q + 1), hash } : { base: noHash, query: '', hash }
}

export function parseQuery(query: string): KV[] {
  if (!query) return []
  return query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    // mantemos o texto como digitado: o usuário pode ter escrito %20 de propósito
    return eq >= 0 ? { key: pair.slice(0, eq), value: pair.slice(eq + 1) } : { key: pair, value: '' }
  })
}

export const buildQuery = (params: KV[]) =>
  params
    .filter((p) => !p.disabled && (p.key || p.value))
    .map((p) => (p.value === '' && !p.key.includes('=') ? p.key : `${p.key}=${p.value}`))
    .join('&')

/** Raw mudou: recalcula a lista de query, preservando parâmetros desativados e descrições. */
export function urlFromRaw(raw: string, prev?: PMUrl): PMUrl {
  const { base, query } = splitRaw(raw)
  const enabled = parseQuery(query)
  const prevQ = prev?.query || []
  const disabled = prevQ.filter((p) => p.disabled)
  const withDesc = enabled.map((p) => ({ ...p, description: prevQ.find((x) => !x.disabled && x.key === p.key)?.description }))
  return { raw, query: [...withDesc, ...disabled], variable: pathVariables(base, prev?.variable) }
}

/** Tabela de params mudou: reescreve o raw. */
export function urlFromQuery(url: PMUrl, query: KV[]): PMUrl {
  const { base, hash } = splitRaw(url.raw)
  const q = buildQuery(query)
  return { ...url, raw: `${base}${q ? `?${q}` : ''}${hash}`, query }
}

/** Segmentos `:id` viram variáveis de caminho, como no Postman. */
export function pathVariables(base: string, prev: KV[] = []): KV[] {
  const names = [...base.replace(/^[a-z]+:\/\/[^/]*/i, '').matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => m[1])
  return names.map((key) => prev.find((v) => v.key === key) || { key, value: '' })
}

export const decodeForDisplay = decode

// ---------------- árvore de itens ----------------

export interface Found {
  item: PMItem
  siblings: PMItem[]
  index: number
  ancestors: PMItem[] // do topo até o pai direto
}

export function findItem(items: PMItem[], id: string, ancestors: PMItem[] = []): Found | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.id === id) return { item: it, siblings: items, index: i, ancestors }
    if (it.item) {
      const f = findItem(it.item, id, [...ancestors, it])
      if (f) return f
    }
  }
  return null
}

export function walk(items: PMItem[], fn: (it: PMItem) => void) {
  for (const it of items) {
    fn(it)
    if (it.item) walk(it.item, fn)
  }
}

export const isFolder = (it: PMItem) => Array.isArray(it.item)

export function containsId(item: PMItem, id: string): boolean {
  if (item.id === id) return true
  return !!item.item?.some((c) => containsId(c, id))
}

/** Cópia com ids novos (duplicar). */
export function reId(item: PMItem): PMItem {
  const c = clone(item)
  walk([c], (it) => (it.id = uid()))
  return c
}

export function newRequestItem(name = 'Nova requisição', req?: Partial<PMRequest>): PMItem {
  return {
    id: uid(),
    name,
    request: { method: 'GET', header: [], url: { raw: '' }, ...req } as PMRequest,
    event: []
  }
}

export const newFolder = (name = 'Nova pasta'): PMItem => ({ id: uid(), name, item: [] })

export const newCollection = (name = 'Nova coleção'): PMCollection => ({
  info: { _postman_id: uid(), name, schema: COLLECTION_SCHEMA },
  item: [],
  variable: [],
  event: []
})

/** Auth efetiva de uma requisição, subindo pelas pastas até a coleção. */
export function effectiveAuth(col: PMCollection | undefined, ancestors: PMItem[], own?: PMAuth | null): { auth: PMAuth | null; from: string } {
  if (own && own.type !== 'inherit') return { auth: own, from: 'request' }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i].auth
    if (a && a.type !== 'inherit') return { auth: a, from: ancestors[i].name }
  }
  if (col?.auth && col.auth.type !== 'inherit') return { auth: col.auth, from: col.info.name }
  return { auth: null, from: '' }
}

// ---------------- scripts ----------------

export function getScript(events: PMEvent[] | undefined, listen: 'prerequest' | 'test'): string {
  const ev = events?.find((e) => e.listen === listen)
  if (!ev) return ''
  return Array.isArray(ev.script.exec) ? ev.script.exec.join('\n') : ev.script.exec || ''
}

export function setScript(events: PMEvent[] | undefined, listen: 'prerequest' | 'test', code: string): PMEvent[] {
  const rest = (events || []).filter((e) => e.listen !== listen)
  if (!code.trim()) return rest
  return [...rest, { listen, script: { type: 'text/javascript', exec: code.split('\n') } }]
}

// ---------------- variáveis ----------------

export type VarSource = 'global' | 'collection' | 'environment'
export interface ResolvedVar {
  value: string
  source: VarSource
}

/** Precedência do Postman: global < coleção < ambiente. */
export function variableMap(globals: EnvValue[], collectionVars: KV[] | undefined, env: EnvValue[] | undefined) {
  const m = new Map<string, ResolvedVar>()
  for (const v of globals) if (v.enabled !== false && v.key) m.set(v.key, { value: v.value, source: 'global' })
  for (const v of collectionVars || []) if (!v.disabled && v.key) m.set(v.key, { value: String(v.value ?? ''), source: 'collection' })
  for (const v of env || []) if (v.enabled !== false && v.key) m.set(v.key, { value: v.value, source: 'environment' })
  return m
}

const DYNAMIC = /^\$(guid|randomUUID|timestamp|isoTimestamp|randomInt|random\w*)$/

export const isDynamicVar = (name: string) => DYNAMIC.test(name)

export function resolveVars(text: string, vars: Map<string, ResolvedVar>, depth = 0): string {
  if (depth > 5) return text
  return text.replace(/\{\{([^{}]+)\}\}/g, (all, name) => {
    const v = vars.get(name.trim())
    return v ? resolveVars(v.value, vars, depth + 1) : all
  })
}

// ---------------- formatação ----------------

export function formatBytes(n = 0) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export const formatMs = (n = 0) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`)

export function b64ToText(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

export function prettyBody(text: string, mime: string): { text: string; lang: 'json' | 'xml' | 'html' | 'javascript' | 'text' } {
  const m = mime.toLowerCase()
  const t = text.trim()
  if (m.includes('json') || /^[[{]/.test(t)) {
    try {
      return { text: JSON.stringify(JSON.parse(text), null, 2), lang: 'json' }
    } catch {
      /* não é JSON válido: mostra como veio */
    }
  }
  if (m.includes('html')) return { text, lang: 'html' }
  if (m.includes('xml') || t.startsWith('<?xml')) return { text: prettyXml(text), lang: 'xml' }
  if (m.includes('javascript')) return { text, lang: 'javascript' }
  return { text, lang: 'text' }
}

function prettyXml(xml: string) {
  let indent = 0
  return xml
    .replace(/>\s*</g, '><')
    .replace(/</g, '\n<')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      if (/^<\//.test(line)) indent = Math.max(indent - 1, 0)
      const out = '  '.repeat(indent) + line
      if (/^<[^!?/][^>]*[^/]>$/.test(line) && !/<\/[^>]+>$/.test(line)) indent++
      return out
    })
    .join('\n')
}

export function statusColor(code?: number) {
  if (!code) return 'var(--fg-muted)'
  if (code < 300) return 'var(--ok)'
  if (code < 400) return 'var(--m-put)'
  return 'var(--err)'
}

export const STATUS_HINT: Record<number, string> = {
  200: 'Requisição bem-sucedida.',
  201: 'Recurso criado.',
  204: 'Sucesso, sem conteúdo.',
  301: 'Movido permanentemente.',
  302: 'Encontrado em outro endereço.',
  304: 'Não modificado (cache).',
  400: 'Requisição malformada.',
  401: 'Falta autenticação ou credencial inválida.',
  403: 'Sem permissão para este recurso.',
  404: 'Recurso não encontrado.',
  405: 'Método não permitido.',
  409: 'Conflito com o estado atual.',
  422: 'Dados inválidos.',
  429: 'Muitas requisições.',
  500: 'Erro interno no servidor.',
  502: 'Gateway inválido.',
  503: 'Serviço indisponível.',
  504: 'Tempo esgotado no gateway.'
}

/** Linhas `chave:valor` (prefixo `//` = desativado), como o modo bulk edit. */
export const kvToBulk = (rows: KV[]) =>
  rows
    .filter((r) => r.key || r.value)
    .map((r) => `${r.disabled ? '//' : ''}${r.key}:${r.value}`)
    .join('\n')

export function bulkToKv(text: string, prev: KV[]): KV[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const disabled = line.startsWith('//')
      const l = disabled ? line.slice(2) : line
      const i = l.indexOf(':')
      const key = (i >= 0 ? l.slice(0, i) : l).trim()
      const value = i >= 0 ? l.slice(i + 1).trim() : ''
      const old = prev.find((p) => p.key === key)
      return { ...old, key, value, disabled: disabled || undefined }
    })
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const [head, ...rest] = rows.filter((r) => r.some((c) => c !== ''))
  if (!head) return []
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])))
}

export function timeAgo(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === y.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}
