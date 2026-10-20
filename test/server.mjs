// Servidor HTTP/WebSocket local para os testes (unitários, CLI e E2E). Sem dependências externas além do `ws`.
// Uso direto: node test/server.mjs [porta]
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
  })
}

const json = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(data))
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname
  const body = await readBody(req)
  const echo = {
    method: req.method,
    path: p,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers,
    body,
    json: (() => {
      try {
        return JSON.parse(body)
      } catch {
        return undefined
      }
    })()
  }
  if (p === '/get' || p === '/post' || p === '/put' || p === '/patch' || p === '/delete' || p === '/anything' || p.startsWith('/anything/'))
    return json(res, 200, echo)
  let m
  if ((m = /^\/status\/(\d{3})$/.exec(p))) return json(res, Number(m[1]), { status: Number(m[1]) })
  if ((m = /^\/delay\/(\d+)$/.exec(p))) return setTimeout(() => json(res, 200, { delayed: Number(m[1]) }), Number(m[1]))
  if (p === '/cookies/set') {
    const cookies = [...url.searchParams].map(([k, v]) => `${k}=${encodeURIComponent(v)}; Path=/`)
    return json(res, 200, { set: Object.fromEntries(url.searchParams) }, { 'set-cookie': cookies })
  }
  if (p === '/cookies') {
    const jar = Object.fromEntries(
      (req.headers.cookie || '')
        .split(/;\s*/)
        .filter(Boolean)
        .map((c) => c.split('='))
    )
    return json(res, 200, { cookies: jar })
  }
  if (p === '/bearer') {
    const auth = req.headers.authorization || ''
    if (!auth.startsWith('Bearer ')) return json(res, 401, { authenticated: false })
    return json(res, 200, { authenticated: true, token: auth.slice(7) })
  }
  if (p === '/redirect') {
    res.writeHead(302, { location: '/get?redirected=1' })
    return res.end()
  }
  if (p === '/html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end('<!doctype html><h1>Olá do servidor de teste</h1>')
  }
  if (p === '/users')
    return json(res, 200, [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' }
    ])
  if ((m = /^\/users\/(\d+)$/.exec(p)))
    return Number(m[1]) <= 2 ? json(res, 200, { id: Number(m[1]), name: Number(m[1]) === 1 ? 'Ada' : 'Grace' }) : json(res, 404, { error: 'not found' })
  json(res, 404, { error: 'not found', path: p })
}

export function startTestServer(port = 0) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: String(e) }))
  })
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws) => ws.on('message', (data, isBinary) => ws.send(isBinary ? data : `echo: ${data}`)))
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address()
      resolve({
        port: p,
        url: `http://127.0.0.1:${p}`,
        wsUrl: `ws://127.0.0.1:${p}/ws`,
        close: () =>
          new Promise((r) => {
            wss.close()
            server.closeAllConnections()
            server.close(() => r())
          })
      })
    })
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startTestServer(Number(process.argv[2]) || 4555).then((s) => console.log(`servidor de teste em ${s.url} (ws: ${s.wsUrl})`))
}
