import { app } from 'electron'
import fs from 'fs'
import util from 'util'
import type {
  ConsoleEntry,
  EnvValue,
  Environment,
  HttpResult,
  KV,
  PMCollection,
  PMItem,
  RunnerEvent,
  RunnerOptions,
  SendPayload,
  TestResult
} from '@shared/types'
import { getSettings } from './storage'
import { getJar, persistJar, toCookieInfo } from './cookies'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runtime = require('postman-runtime')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sdk = require('postman-collection')

const activeRuns = new Map<string, any>()
const USER_AGENT = `Postgirl/${app.getVersion()}`

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

function prepareItems(items: PMItem[] = []): any[] {
  return items.map((it) => {
    const out: any = { ...it }
    if (it.request) {
      const header = it.request.header || []
      // identidade própria no lugar do "PostmanRuntime/x" que o motor colocaria
      const hasUA = header.some((h) => !h.disabled && h.key?.toLowerCase() === 'user-agent')
      out.request = { ...it.request, url: normalizeUrl(it.request.url), header: hasUA ? header : [...header, { key: 'User-Agent', value: USER_AGENT }] }
    }
    if (it.request?.auth?.type === 'inherit') delete out.request.auth
    if (it.auth?.type === 'inherit') delete out.auth
    if (it.item) out.item = prepareItems(it.item)
    return out
  })
}

export function toSdkCollection(c: PMCollection) {
  const json: any = { ...c, item: prepareItems(c.item) }
  if (json.auth?.type === 'inherit') delete json.auth
  return new sdk.Collection(json)
}

const toScope = (values: EnvValue[] = []) =>
  new sdk.VariableScope({
    values: values
      .filter((v) => v.key)
      .map((v) => ({ key: v.key, value: v.value, type: 'any', disabled: v.enabled === false }))
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

const formatArg = (m: any) =>
  typeof m === 'string' ? m : util.inspect(m, { depth: 6, breakLength: 100, colors: false })

function runOptions(environment: Environment | null, globals: EnvValue[]) {
  const s = getSettings()
  return {
    environment: toScope(environment?.values),
    globals: toScope(globals),
    fileResolver: fs,
    timeout: s.timeoutMs ? { request: s.timeoutMs } : undefined,
    requester: {
      cookieJar: getJar(),
      followRedirects: s.followRedirects,
      strictSSL: s.strictSSL,
      maxResponseSize: s.maxResponseMB * 1024 * 1024,
      implicitTraceHeader: false
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

export function sendRequest(p: SendPayload): Promise<HttpResult> {
  return new Promise((resolve) => {
    const collection = toSdkCollection(p.collection)
    const opts: any = { ...runOptions(p.environment, p.globals), entrypoint: { execute: p.itemId, lookupStrategy: 'idOrName' } }
    const result: HttpResult = { ok: false, tests: [], console: [] }

    new runtime.Runner().run(collection, opts, (err: any, run: any) => {
      if (err) return resolve({ ...result, error: String(err.message || err) })
      activeRuns.set(p.runId, run)
      run.start({
        console: (_c: any, level: string, ...messages: any[]) =>
          result.console.push({ level, messages: messages.map(formatArg), at: Date.now() }),
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
          activeRuns.delete(p.runId)
          persistJar()
          if (e && !result.error) result.error = e.message || String(e)
          result.environment = fromScope(opts.environment, p.environment?.values)
          result.globals = fromScope(opts.globals, p.globals)
          result.collectionVariables = collection.variables.all().map((v: any) => ({
            key: v.key,
            value: typeof v.value === 'string' ? v.value : JSON.stringify(v.value),
            disabled: v.disabled || undefined
          })) as KV[]
          resolve(result)
        }
      })
    })
  })
}

export function cancelRun(runId: string) {
  const run = activeRuns.get(runId)
  if (run) run.abort()
  activeRuns.delete(runId)
}

export function startRunner(o: RunnerOptions, emit: (e: RunnerEvent) => void) {
  const collection = toSdkCollection(o.collection)
  const opts: any = {
    ...runOptions(o.environment, o.globals),
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
    activeRuns.set(o.runId, run)
    run.start({
      start: (_e: any, cursor: any) => emit({ runId: o.runId, type: 'start', total: cursor?.length * (cursor?.cycles || 1) || 0 }),
      console: (_c: any, level: string, ...messages: any[]) =>
        emit({ runId: o.runId, type: 'console', entry: { level, messages: messages.map(formatArg), at: Date.now() } as ConsoleEntry }),
      exception: (c: any, e: any) => slot(c).tests.push({ name: `Erro no script: ${e?.message}`, passed: false, skipped: false }),
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
        activeRuns.delete(o.runId)
        persistJar()
        emit({
          runId: o.runId,
          type: 'done',
          error: e ? e.message || String(e) : undefined,
          environment: o.persistVariables ? fromScope(opts.environment, o.environment?.values) : undefined,
          globals: o.persistVariables ? fromScope(opts.globals, o.globals) : undefined,
          collectionVariables: o.persistVariables
            ? collection.variables.all().map((v: any) => ({ key: v.key, value: String(v.value ?? ''), disabled: v.disabled || undefined }))
            : undefined
        })
      }
    })
  })
}
