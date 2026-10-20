// Motor de execução sobre o postman-runtime. Não depende do Electron: o app e a CLI usam o mesmo código.
import fs from 'fs'
import util from 'util'
import type {
  ConsoleEntry,
  EnvValue,
  Environment,
  HttpResult,
  KV,
  NetworkSettings,
  PMCollection,
  PMItem,
  RunnerEvent,
  RunnerOptions,
  SendPayload,
  TestResult
} from '@shared/types'

import runtime from 'postman-runtime'
import sdk from 'postman-collection'

export interface EngineContext {
  userAgent: string
  network: NetworkSettings
  cookieJar?: unknown
  /** resolve o proxy do sistema para uma URL; o app usa o do Chromium */
  systemProxy?: (url: string, cb: (err: Error | null, config?: unknown) => void) => void
  /** recebe o objeto run assim que ele existe, para permitir cancelar */
  onRun?: (run: { abort(): void }) => void
}

/**
 * O editor guarda a URL como `raw` + lista `query` (que inclui parâmetros desativados).
 * O SDK só lê os campos estruturados, então derivamos a estrutura a partir do raw.
 */
function normalizeUrl(url: any) {
  if (!url || typeof url === 'string') return url
  if (typeof url.raw !== 'string') return url
  const parsed = sdk.Url.parse(url.raw)
  if (Array.isArray(url.query)) parsed.query = url.query
  if (Array.isArray(url.variable)) parsed.variable = url.variable
  parsed.raw = url.raw
  return parsed
}

function prepareItems(items: PMItem[] = [], userAgent: string): any[] {
  return items.map((it) => {
    const out: any = { ...it }
    if (it.request) {
      const header = it.request.header || []
      // identidade própria no lugar do "PostmanRuntime/x" que o motor colocaria
      const hasUA = header.some((h) => !h.disabled && h.key?.toLowerCase() === 'user-agent')
      out.request = { ...it.request, url: normalizeUrl(it.request.url), header: hasUA ? header : [...header, { key: 'User-Agent', value: userAgent }] }
    }
    if (it.request?.auth?.type === 'inherit') delete out.request.auth
    if (it.auth?.type === 'inherit') delete out.auth
    if (it.item) out.item = prepareItems(it.item, userAgent)
    return out
  })
}

export function toSdkCollection(c: PMCollection, userAgent = 'Postwoman') {
  const json: any = { ...c, item: prepareItems(c.item, userAgent) }
  if (json.auth?.type === 'inherit') delete json.auth
  return new sdk.Collection(json)
}

const toScope = (values: EnvValue[] = []) =>
  new sdk.VariableScope({
    values: values.filter((v) => v.key).map((v) => ({ key: v.key, value: v.value, type: 'any', disabled: v.enabled === false }))
  })

/** Lê o escopo de volta, mantendo o tipo (secret) e a flag enabled originais. */
function fromScope(scope: any, original: EnvValue[] = []): EnvValue[] {
  const byKey = new Map(original.map((v) => [v.key, v]))
  return scope.values.map((v: any) => {
    const prev = byKey.get(v.key)
    return {
      key: v.key,
      value: typeof v.value === 'string' ? v.value : JSON.stringify(v.value),
      enabled: !v.disabled,
      type: prev?.type || 'default'
    }
  })
}

const collectionVars = (collection: any): KV[] =>
  collection.variables.all().map((v: any) => ({
    key: v.key,
    value: typeof v.value === 'string' ? v.value : JSON.stringify(v.value),
    disabled: v.disabled || undefined
  }))

const formatArg = (m: any) => (typeof m === 'string' ? m : util.inspect(m, { depth: 6, breakLength: 100, colors: false }))

/** "api.x.com" ou "*.x.com" -> padrão de URL do SDK, em qualquer porta */
const hostPattern = (host: string, scheme = 'http+https') =>
  `${scheme}://${host
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')}:*/*`

const splitList = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)

/** Lista de proxies do SDK a partir das configurações (null quando não há proxy manual). */
export function buildProxies(n: NetworkSettings) {
  if (n.proxy?.mode !== 'custom' || !n.proxy.url.trim()) return undefined
  const raw = /^[a-z0-9]+:\/\//i.test(n.proxy.url) ? n.proxy.url.trim() : `http://${n.proxy.url.trim()}`
  const u = new URL(raw)
  const protocol = u.protocol.replace(':', '')
  return new sdk.ProxyConfigList({}, [
    {
      match: 'http+https://*:*/*', // o padrão do SDK sem ':*' não casa URLs com porta
      host: u.hostname,
      port: Number(u.port) || (protocol.startsWith('socks') ? 1080 : 8080),
      protocol,
      tunnel: false,
      bypass: splitList(n.proxy.bypass || '').map((h) => hostPattern(h)),
      authenticate: !!n.proxy.username,
      username: n.proxy.username || undefined,
      password: n.proxy.password || undefined
    }
  ])
}

export function buildCertificates(n: NetworkSettings) {
  const list = (n.clientCerts || []).filter((c) => c.host.trim() && (c.pfxPath || c.certPath))
  if (!list.length) return undefined
  return new sdk.CertificateList(
    {},
    list.map((c) => ({
      matches: [hostPattern(c.host, 'https')],
      cert: c.certPath ? { src: c.certPath } : undefined,
      key: c.keyPath ? { src: c.keyPath } : undefined,
      pfx: c.pfxPath ? { src: c.pfxPath } : undefined,
      passphrase: c.passphrase || undefined
    }))
  )
}

export function runOptions(ctx: EngineContext, environment: Environment | null, globals: EnvValue[]) {
  const n = ctx.network
  return {
    environment: toScope(environment?.values),
    globals: toScope(globals),
    fileResolver: fs,
    timeout: n.timeoutMs ? { request: n.timeoutMs } : undefined,
    proxies: buildProxies(n),
    systemProxy: n.proxy?.mode === 'system' ? ctx.systemProxy : undefined,
    // 'off' ignora também HTTP_PROXY/HTTPS_PROXY; 'system' e a CLI respeitam essas variáveis
    ignoreProxyEnvironmentVariables: n.proxy?.mode === 'off' || n.proxy?.mode === 'custom',
    certificates: buildCertificates(n),
    requester: {
      cookieJar: ctx.cookieJar,
      followRedirects: n.followRedirects,
      strictSSL: n.strictSSL,
      maxResponseSize: n.maxResponseMB * 1024 * 1024,
      implicitTraceHeader: false,
      extendedRootCA: n.caCertPath || undefined
    }
  }
}

function describeBody(body: any): string | undefined {
  if (!body || body.disabled) return undefined
  switch (body.mode) {
    case 'raw':
      return body.raw
    case 'urlencoded':
      return body.urlencoded
        ?.filter((p: any) => !p.disabled)
        .map((p: any) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
        .join('&')
    case 'formdata':
      return body.formdata
        ?.filter((p: any) => !p.disabled)
        .map((p: any) => `${p.key}: ${p.type === 'file' ? `<arquivo ${p.src}>` : p.value}`)
        .join('\n')
    case 'graphql':
      return JSON.stringify(body.graphql)
    case 'file':
      return `<arquivo ${body.file?.src}>`
  }
  return undefined
}

function testFromAssertion(a: any): TestResult {
  return { name: a.name, passed: !!a.passed && !a.error, skipped: !!a.skipped, error: a.error?.message }
}

/** Executa uma requisição da coleção, com herança de auth, scripts e variáveis de pastas e coleção. */
export function sendRequest(ctx: EngineContext, p: SendPayload): Promise<HttpResult> {
  return new Promise((resolve) => {
    const collection = toSdkCollection(p.collection, ctx.userAgent)
    const opts: any = { ...runOptions(ctx, p.environment, p.globals), entrypoint: { execute: p.itemId, lookupStrategy: 'idOrName' } }
    const result: HttpResult = { ok: false, tests: [], console: [] }

    new runtime.Runner().run(collection, opts, (err: any, run: any) => {
      if (err) return resolve({ ...result, error: String(err.message || err) })
      ctx.onRun?.(run)
      run.start({
        console: (_c: any, level: string, ...messages: any[]) => result.console.push({ level, messages: messages.map(formatArg), at: Date.now() }),
        exception: (_c: any, e: any) => {
          result.console.push({ level: 'error', messages: [`${e?.name || 'Error'}: ${e?.message}`], at: Date.now() })
          result.tests.push({ name: `Erro no script: ${e?.message}`, passed: false, skipped: false, error: e?.message })
        },
        assertion: (_c: any, assertions: any[]) => assertions.forEach((a) => result.tests.push(testFromAssertion(a))),
        request: (e: any, _c: any, response: any, request: any, _item: any, cookies: any[], history: any) => {
          if (request) {
            result.sent = {
              method: request.method,
              url: request.url.toString(),
              headers: request.headers.all().map((h: any) => ({ key: h.key, value: h.value })),
              body: describeBody(request.body?.toJSON?.() ?? request.body)
            }
          }
          if (e) {
            result.error = e.message || String(e)
            return
          }
          if (!response) return
          const timings = history?.execution?.data?.[history.execution.data.length - 1]?.timings
          result.ok = true
          result.response = {
            code: response.code,
            status: response.status,
            headers: response.headers.all().map((h: any) => ({ key: h.key, value: h.value })),
            bodyBase64: response.stream ? Buffer.from(response.stream).toString('base64') : '',
            mime: (response.headers.get('Content-Type') || response.contentInfo()?.contentType || '').split(';')[0].trim(),
            time: response.responseTime,
            size: response.size(),
            timings: timings ? sdk.Response.timingPhases(timings) : undefined,
            cookies: (cookies || []).map(toCookieInfo)
          }
        },
        item: (_e: any, _c: any, _item: any, visualizer: any) => {
          if (visualizer) result.visualizer = { html: visualizer.processedTemplate, error: visualizer.error?.message }
        },
        done: (e: any) => {
          if (e && !result.error) result.error = e.message || String(e)
          result.environment = fromScope(opts.environment, p.environment?.values)
          result.globals = fromScope(opts.globals, p.globals)
          result.collectionVariables = collectionVars(collection)
          resolve(result)
        }
      })
    })
  })
}

/** Executa a coleção (ou uma pasta) inteira, emitindo um evento por requisição. */
export function runCollection(ctx: EngineContext, o: RunnerOptions, emit: (e: RunnerEvent) => void) {
  const collection = toSdkCollection(o.collection, ctx.userAgent)
  const opts: any = {
    ...runOptions(ctx, o.environment, o.globals),
    iterationCount: o.data?.length ? undefined : Math.max(1, o.iterations),
    data: o.data?.length ? o.data : undefined,
    delay: o.delayMs ? { item: o.delayMs } : undefined,
    stopOnError: o.stopOnError,
    entrypoint: o.folderId ? { execute: o.folderId, lookupStrategy: 'idOrName' } : undefined
  }
  if (o.data?.length && o.iterations > 1) opts.iterationCount = o.iterations

  // acumula o que acontece com cada item até o callback `item` (fim do item)
  const pending = new Map<string, any>()
  const keyOf = (c: any) => `${c.iteration}:${c.ref}`
  const slot = (c: any) => {
    const k = keyOf(c)
    if (!pending.has(k)) pending.set(k, { tests: [] as TestResult[] })
    return pending.get(k)
  }

  new runtime.Runner().run(collection, opts, (err: any, run: any) => {
    if (err) return emit({ runId: o.runId, type: 'done', error: String(err.message || err) })
    ctx.onRun?.(run)
    run.start({
      start: (_e: any, cursor: any) => emit({ runId: o.runId, type: 'start', total: cursor?.length * (cursor?.cycles || 1) || 0 }),
      console: (_c: any, level: string, ...messages: any[]) =>
        emit({ runId: o.runId, type: 'console', entry: { level, messages: messages.map(formatArg), at: Date.now() } as ConsoleEntry }),
      exception: (c: any, e: any) => slot(c).tests.push({ name: `Erro no script: ${e?.message}`, passed: false, skipped: false, error: e?.message }),
      assertion: (c: any, assertions: any[]) => assertions.forEach((a) => slot(c).tests.push(testFromAssertion(a))),
      request: (e: any, c: any, response: any, request: any) => {
        const s = slot(c)
        s.method = request?.method
        s.url = request?.url?.toString()
        if (e) s.error = e.message || String(e)
        if (response) Object.assign(s, { code: response.code, status: response.status, time: response.responseTime, size: response.size().total })
      },
      item: (_e: any, c: any, item: any) => {
        const s = slot(c)
        pending.delete(keyOf(c))
        emit({
          runId: o.runId,
          type: 'item',
          iteration: c.iteration,
          itemId: item.id,
          name: item.name,
          method: s.method || item.request?.method,
          url: s.url || item.request?.url?.toString(),
          code: s.code,
          status: s.status,
          time: s.time,
          size: s.size,
          tests: s.tests,
          error: s.error
        })
      },
      done: (e: any) => {
        emit({
          runId: o.runId,
          type: 'done',
          error: e ? e.message || String(e) : undefined,
          environment: o.persistVariables ? fromScope(opts.environment, o.environment?.values) : undefined,
          globals: o.persistVariables ? fromScope(opts.globals, o.globals) : undefined,
          collectionVariables: o.persistVariables ? collectionVars(collection) : undefined
        })
      }
    })
  })
}

export function toCookieInfo(c: any) {
  return {
    key: c.key ?? c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires && c.expires !== 'Infinity' ? new Date(c.expires).toISOString() : undefined,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure
  }
}
