// Formato de dados: segue o schema Postman Collection v2.1, para que as coleções
// salvas pelo Relay abram no Postman e vice-versa.

export const COLLECTION_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

export interface KV {
  key: string
  value: string
  disabled?: boolean
  description?: string
  type?: string // formdata: 'text' | 'file'; auth params: 'string' | 'any' ...
  src?: string | string[] | null // formdata file
  contentType?: string
}

export interface PMUrl {
  raw: string
  protocol?: string
  host?: string[]
  port?: string
  path?: string[]
  query?: KV[]
  variable?: KV[]
  hash?: string
}

export type BodyMode = 'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql'
export type RawLanguage = 'text' | 'json' | 'javascript' | 'html' | 'xml'

export interface PMBody {
  mode?: BodyMode
  raw?: string
  urlencoded?: KV[]
  formdata?: KV[]
  file?: { src?: string | null }
  graphql?: { query: string; variables?: string }
  options?: { raw?: { language: RawLanguage } }
  disabled?: boolean
}

export interface PMAuth {
  type: string
  [param: string]: any
}

export interface PMEvent {
  listen: 'prerequest' | 'test'
  script: { type?: string; exec: string[] | string; id?: string }
}

export interface PMRequest {
  method: string
  header: KV[]
  url: PMUrl
  body?: PMBody
  auth?: PMAuth | null
  description?: string
}

export type Protocol = 'http' | 'websocket' | 'socketio' | 'mqtt' | 'grpc'

/** Extensão própria para protocolos que o schema v2.1 não cobre. O Postman ignora o campo. */
export interface RelayExt {
  protocol: Exclude<Protocol, 'http'>
  config: Record<string, any>
}

export interface PMItem {
  id: string
  name: string
  description?: string
  request?: PMRequest
  item?: PMItem[]
  event?: PMEvent[]
  auth?: PMAuth | null
  variable?: KV[]
  response?: any[]
  protocolProfileBehavior?: Record<string, any>
  relay?: RelayExt
}

export interface PMCollection {
  info: { _postman_id: string; name: string; schema: string; description?: string }
  item: PMItem[]
  event?: PMEvent[]
  variable?: KV[]
  auth?: PMAuth | null
}

export interface EnvValue {
  key: string
  value: string
  enabled: boolean
  type?: 'default' | 'secret' | 'any'
}

export interface Environment {
  id: string
  name: string
  values: EnvValue[]
}

export interface HistoryEntry {
  id: string
  at: number
  method: string
  url: string
  code?: number
  request: PMRequest
}

export interface Settings {
  workspacePath: string
  followRedirects: boolean
  strictSSL: boolean
  timeoutMs: number // 0 = sem limite
  maxResponseMB: number
  theme: 'system' | 'light' | 'dark'
  layout: 'vertical' | 'horizontal'
}

export interface Workspace {
  path: string
  collections: PMCollection[]
  environments: Environment[]
  globals: EnvValue[]
  history: HistoryEntry[]
  settings: Settings
}

export interface TestResult {
  name: string
  passed: boolean
  skipped: boolean
  error?: string
}

export interface ConsoleEntry {
  level: string
  messages: string[]
  at: number
}

export interface CookieInfo {
  key: string
  value: string
  domain: string
  path: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
}

export interface HttpResult {
  ok: boolean
  error?: string
  response?: {
    code: number
    status: string
    headers: { key: string; value: string }[]
    bodyBase64: string
    mime: string
    time: number
    size: { body: number; header: number; total: number }
    timings?: Record<string, number>
    cookies: CookieInfo[]
  }
  sent?: { method: string; url: string; headers: { key: string; value: string }[]; body?: string }
  tests: TestResult[]
  console: ConsoleEntry[]
  visualizer?: { html?: string; error?: string }
  environment?: EnvValue[]
  globals?: EnvValue[]
  collectionVariables?: KV[]
}

export interface SendPayload {
  runId: string
  collection: PMCollection
  itemId: string
  environment: Environment | null
  globals: EnvValue[]
}

export interface RunnerOptions {
  runId: string
  collection: PMCollection
  folderId?: string
  environment: Environment | null
  globals: EnvValue[]
  iterations: number
  delayMs: number
  data?: Record<string, any>[]
  stopOnError: boolean
  persistVariables: boolean
}

export type RunnerEvent =
  | { runId: string; type: 'start'; total: number }
  | { runId: string; type: 'item'; iteration: number; itemId: string; name: string; method: string; url: string; code?: number; status?: string; time?: number; size?: number; tests: TestResult[]; error?: string }
  | { runId: string; type: 'console'; entry: ConsoleEntry }
  | { runId: string; type: 'done'; error?: string; environment?: EnvValue[]; globals?: EnvValue[]; collectionVariables?: KV[] }

export interface ImportResult {
  collections: PMCollection[]
  environments: Environment[]
  errors: string[]
}

export interface CodegenLanguage {
  key: string
  label: string
  syntax_mode: string
  variants: { key: string }[]
}

// --- protocolos em tempo real (WebSocket, Socket.IO, MQTT, gRPC) ---

export type RealtimeEvent =
  | { connId: string; type: 'status'; status: 'connecting' | 'connected' | 'disconnected' | 'error'; detail?: string }
  | { connId: string; type: 'message'; direction: 'in' | 'out'; event?: string; topic?: string; data: string; at: number; binary?: boolean }
  | { connId: string; type: 'grpc-end'; status: string; code: number; metadata?: Record<string, string>; trailers?: Record<string, string>; time: number }
