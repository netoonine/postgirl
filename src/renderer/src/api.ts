import type {
  CodegenLanguage,
  CookieInfo,
  Environment,
  EnvValue,
  HistoryEntry,
  HttpResult,
  ImportResult,
  KV,
  PMAuth,
  PMCollection,
  PMRequest,
  RealtimeEvent,
  RunnerEvent,
  RunnerOptions,
  SendPayload,
  Settings,
  Workspace
} from '@shared/types'

export interface GrpcMethodInfo {
  service: string
  method: string
  path: string
  requestStream: boolean
  responseStream: boolean
  sample: string
}

export interface OAuth2Token {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  id_token?: string
  error?: string
  raw?: any
}

interface Api {
  loadWorkspace(): Promise<Workspace>
  chooseWorkspace(): Promise<Workspace | null>
  saveSettings(s: Partial<Settings>): Promise<Settings>
  saveCollection(c: PMCollection): Promise<void>
  deleteCollection(id: string): Promise<void>
  saveEnvironment(e: Environment): Promise<void>
  deleteEnvironment(id: string): Promise<void>
  saveGlobals(v: EnvValue[]): Promise<void>
  addHistory(h: HistoryEntry): Promise<HistoryEntry[]>
  clearHistory(): Promise<void>
  send(p: SendPayload): Promise<HttpResult>
  cancel(runId: string): Promise<void>
  runnerStart(o: RunnerOptions): Promise<void>
  runnerStop(runId: string): Promise<void>
  onRunnerEvent(cb: (e: RunnerEvent) => void): () => void
  listCookies(): Promise<CookieInfo[]>
  deleteCookie(domain: string, path: string, key: string): Promise<void>
  clearCookies(domain?: string): Promise<void>
  codegenLanguages(): Promise<CodegenLanguage[]>
  codegen(o: { request: PMRequest; auth?: PMAuth | null; lang: string; variant: string; variables: (EnvValue | KV)[] }): Promise<string>
  importText(text: string, name?: string): Promise<ImportResult>
  importCurl(text: string): Promise<PMRequest>
  importFiles(): Promise<ImportResult | null>
  oauth2Token(c: Record<string, any>): Promise<OAuth2Token>
  openFile(o?: { title?: string; extensions?: string[]; multi?: boolean }): Promise<string | string[] | null>
  saveFile(name: string, content: string, base64?: boolean): Promise<boolean>
  readText(path: string): Promise<string>
  pathForFile(f: File): string
  onMenu(cb: (id: string) => void): () => void
  rt: {
    ws(o: { connId: string; url: string; headers: Record<string, string>; protocols?: string[] }): Promise<void>
    io(o: { connId: string; url: string; path?: string; headers: Record<string, string>; auth?: string; events: string[] }): Promise<void>
    mqtt(o: {
      connId: string
      url: string
      clientId?: string
      username?: string
      password?: string
      subscriptions: { topic: string; qos: 0 | 1 | 2 }[]
      version?: 4 | 5
    }): Promise<void>
    grpcLoad(o: { url: string; protoPath?: string; tls: boolean }): Promise<GrpcMethodInfo[]>
    grpcInvoke(o: {
      connId: string
      url: string
      protoPath?: string
      path: string
      message: string
      metadata: Record<string, string>
      tls: boolean
      deadlineMs?: number
    }): Promise<void>
    send(connId: string, data: string, opts?: any): Promise<void>
    end(connId: string): Promise<void>
    disconnect(connId: string): Promise<void>
    onEvent(cb: (e: RealtimeEvent) => void): () => void
  }
}

export const api: Api = (window as any).api
