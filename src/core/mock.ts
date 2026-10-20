// Mock server local: responde com os exemplos (respostas salvas) das requisições de uma coleção.
// Mesma ideia do mock do Postman, mas rodando na sua máquina, sem conta e sem nuvem.
import http from 'http'
import type { AddressInfo } from 'net'
import type { MockLogEntry, PMCollection, PMItem } from '@shared/types'
import { eachRequest } from './collection'

export interface MockRoute {
  method: string
  segments: string[]
  query: { key: string; value: string }[]
  itemName: string
  example: any
}

const isVar = (seg: string) => seg.startsWith(':') || /^\{\{.+\}\}$/.test(seg) || seg === '*'

/** "{{baseUrl}}/users/:id?x=1" ou "https://api.x.com/v1/users" -> ["users", ":id"] / ["v1","users"] */
export function pathSegments(raw: string): string[] {
  let s = (raw || '').trim().replace(/[?#].*$/, '')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  else if (/^\{\{[^}]+\}\}/.test(s)) s = s.replace(/^\{\{[^}]+\}\}/, '')
  else if (/^[^/]*(\.|:\d|localhost)/i.test(s)) s = s.replace(/^[^/]*/, '')
  return s.split('/').filter(Boolean)
}

function rawUrl(url: any): string {
  if (!url) return ''
  return typeof url === 'string' ? url : url.raw || ''
}

function queryOf(url: any): { key: string; value: string }[] {
  if (url && typeof url === 'object' && Array.isArray(url.query)) return url.query.filter((q: any) => q.key && !q.disabled)
  const raw = rawUrl(url)
  const i = raw.indexOf('?')
  if (i < 0) return []
  return [...new URLSearchParams(raw.slice(i + 1)).entries()].map(([key, value]) => ({ key, value }))
}

export function buildRoutes(c: PMCollection): MockRoute[] {
  const routes: MockRoute[] = []
  eachRequest(c.item, (it: PMItem) => {
    if (it.postwoman || !it.request) return
    for (const ex of it.response || []) {
      const req = ex.originalRequest || it.request
      routes.push({
        method: String(req.method || it.request.method || 'GET').toUpperCase(),
        segments: pathSegments(rawUrl(req.url ?? it.request.url)),
        query: queryOf(req.url ?? it.request.url),
        itemName: it.name,
        example: ex
      })
    }
  })
  return routes
}

/**
 * Escolhe o exemplo que melhor corresponde à requisição.
 * Cabeçalhos aceitos (como no Postman): x-mock-response-name e x-mock-response-code.
 */
export function matchRoute(routes: MockRoute[], method: string, pathname: string, search: URLSearchParams, headers: Record<string, any> = {}) {
  const segs = pathname
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
  const wantName = headers['x-mock-response-name']
  const wantCode = headers['x-mock-response-code'] && Number(headers['x-mock-response-code'])
  let best: { route: MockRoute; score: number } | null = null
  for (const r of routes) {
    if (r.method !== method.toUpperCase() || r.segments.length !== segs.length) continue
    let score = 0
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      if (r.segments[i] === segs[i]) score += 3
      else if (isVar(r.segments[i])) score += 1
      else {
        ok = false
        break
      }
    }
    if (!ok) continue
    for (const q of r.query) if (search.get(q.key) === q.value) score += 1
    if (wantName && r.example.name !== wantName) continue
    if (wantCode && Number(r.example.code) !== wantCode) continue
    const code = Number(r.example.code) || 200
    if (code >= 200 && code < 300) score += 0.5 // empate: prefere a resposta de sucesso
    if (!best || score > best.score) best = { route: r, score }
  }
  return best?.route || null
}

const SKIP_HEADERS = new Set(['content-length', 'transfer-encoding', 'content-encoding', 'connection', 'keep-alive'])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*'
}

export interface MockServer {
  port: number
  routes: () => number
  update: (c: PMCollection) => void
  close: () => Promise<void>
}

export function startMockServer(
  collection: PMCollection,
  o: { port?: number; host?: string; onRequest?: (e: MockLogEntry) => void } = {}
): Promise<MockServer> {
  let routes = buildRoutes(collection)
  const server = http.createServer((req, res) => {
    const started = Date.now()
    const url = new URL(req.url || '/', 'http://mock')
    const method = (req.method || 'GET').toUpperCase()
    const log = (code: number, example?: string) =>
      o.onRequest?.({ at: started, method, path: url.pathname + url.search, code, example, time: Date.now() - started })

    // o corpo é lido e descartado: o exemplo não depende dele
    req.resume()
    req.on('end', () => {
      if (method === 'OPTIONS' && req.headers['access-control-request-method']) {
        res.writeHead(204, CORS)
        res.end()
        return log(204)
      }
      const route = matchRoute(routes, method, url.pathname, url.searchParams, req.headers)
      if (!route) {
        res.writeHead(404, { ...CORS, 'content-type': 'application/json; charset=utf-8' })
        res.end(
          JSON.stringify(
            {
              error: 'Nenhum exemplo corresponde a esta requisição',
              method,
              path: url.pathname,
              dica: 'Salve uma resposta como exemplo na requisição (botão "Salvar como exemplo") para o mock responder.',
              rotas: routes.map((r) => `${r.method} /${r.segments.join('/')} → ${r.example.code || 200} (${r.itemName} · ${r.example.name})`)
            },
            null,
            2
          )
        )
        return log(404)
      }
      const ex = route.example
      const headers: Record<string, string> = { ...CORS, 'x-mock-example': encodeURIComponent(ex.name || '') }
      for (const h of ex.header || []) if (h?.key && !h.disabled && !SKIP_HEADERS.has(h.key.toLowerCase())) headers[h.key.toLowerCase()] = String(h.value ?? '')
      if (!headers['content-type'] && ex._postman_previewlanguage === 'json') headers['content-type'] = 'application/json; charset=utf-8'
      const code = Number(ex.code) || 200
      res.writeHead(code, headers)
      res.end(method === 'HEAD' ? undefined : (ex.body ?? ''))
      log(code, ex.name)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(o.port ?? 0, o.host ?? '127.0.0.1', () => {
      server.off('error', reject)
      resolve({
        port: (server.address() as AddressInfo).port,
        routes: () => routes.length,
        update: (c) => (routes = buildRoutes(c)),
        close: () =>
          new Promise((r) => {
            server.close(() => r())
            server.closeAllConnections()
          })
      })
    })
  })
}
