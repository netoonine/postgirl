import { app, session } from 'electron'
import sdk from 'postman-collection'
import type { HttpResult, RunnerEvent, RunnerOptions, SendPayload } from '@shared/types'
import { EngineContext, runCollection, sendRequest as engineSend } from '../core/engine'
import { getSettings } from './storage'
import { getJar, persistJar } from './cookies'

const activeRuns = new Map<string, { abort(): void }>()

/** Converte a resposta do Chromium ("PROXY h:p; SOCKS5 h:p; DIRECT") no formato do SDK. */
function systemProxy(url: string, cb: (err: Error | null, config?: unknown) => void) {
  session.defaultSession
    .resolveProxy(url)
    .then((r) => {
      const first = r.split(';')[0].trim()
      const m = /^(PROXY|HTTPS|SOCKS5?|SOCKS4)\s+([^:\s]+):(\d+)/i.exec(first)
      if (!m) return cb(null, undefined)
      const kind = m[1].toUpperCase()
      const protocol = kind.startsWith('SOCKS') ? (kind === 'SOCKS4' ? 'socks4' : 'socks5') : kind === 'HTTPS' ? 'https' : 'http'
      cb(null, new sdk.ProxyConfig({ match: 'http+https://*:*/*', host: m[2], port: Number(m[3]), protocol }))
    })
    .catch((e) => cb(e))
}

function context(runId: string): EngineContext {
  return {
    userAgent: `Postgirl/${app.getVersion()}`,
    network: getSettings(),
    cookieJar: getJar(),
    systemProxy,
    onRun: (run) => activeRuns.set(runId, run)
  }
}

export async function sendRequest(p: SendPayload): Promise<HttpResult> {
  try {
    return await engineSend(context(p.runId), p)
  } finally {
    activeRuns.delete(p.runId)
    persistJar()
  }
}

export function cancelRun(runId: string) {
  activeRuns.get(runId)?.abort()
  activeRuns.delete(runId)
}

export function startRunner(o: RunnerOptions, emit: (e: RunnerEvent) => void) {
  runCollection(context(o.runId), o, (e) => {
    if (e.type === 'done') {
      activeRuns.delete(o.runId)
      persistJar()
    }
    emit(e)
  })
}
