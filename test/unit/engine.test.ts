import http from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RunnerEvent } from '@shared/types'
import { buildCertificates, buildProxies, runCollection, sendRequest } from '../../src/core/engine'
import { ctx, DEMO_IDS, demoCollection, demoEnv, startServer, TestServer } from './helpers'

let srv: TestServer
beforeAll(async () => {
  srv = await startServer()
})
afterAll(() => srv.close())

const body = (r: any) => JSON.parse(Buffer.from(r.response.bodyBase64, 'base64').toString())

describe('sendRequest', () => {
  it('executa a requisição com variáveis da coleção, testes e scripts que alteram o ambiente', async () => {
    const r = await sendRequest(ctx(), { runId: '1', collection: demoCollection(srv.url), itemId: DEMO_IDS.list, environment: demoEnv(), globals: [] })
    expect(r.error).toBeUndefined()
    expect(r.response?.code).toBe(200)
    expect(r.tests.map((t) => t.passed)).toEqual([true, true])
    expect(r.environment?.find((v) => v.key === 'firstId')?.value).toBe('1')
    // o tipo "secret" do ambiente original é preservado
    expect(r.environment?.find((v) => v.key === 'token')?.type).toBe('secret')
  })

  it('herda o bearer token da coleção e usa User-Agent próprio', async () => {
    const r = await sendRequest(ctx(), { runId: '2', collection: demoCollection(srv.url), itemId: DEMO_IDS.bearer, environment: demoEnv(), globals: [] })
    expect(body(r).token).toBe('abc123')
    expect(r.sent?.headers.find((h) => h.key.toLowerCase() === 'user-agent')?.value).toBe('Postgirl-Test')
    expect(r.sent?.headers.some((h) => h.key.toLowerCase() === 'postman-token')).toBe(false)
  })

  it('resolve variáveis de caminho (:id)', async () => {
    const env = demoEnv()
    env.values.push({ key: 'firstId', value: '2', enabled: true })
    const r = await sendRequest(ctx(), { runId: '3', collection: demoCollection(srv.url), itemId: DEMO_IDS.get, environment: env, globals: [] })
    expect(r.sent?.url).toBe(`${srv.url}/users/2`)
    expect(body(r).name).toBe('Grace')
    expect(r.tests[0].passed).toBe(false)
  })

  it('devolve erro de rede sem lançar exceção', async () => {
    const c = demoCollection('http://127.0.0.1:1')
    const r = await sendRequest(ctx(), { runId: '4', collection: c, itemId: DEMO_IDS.list, environment: null, globals: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/ECONNREFUSED/)
  })
})

describe('runCollection', () => {
  it('roda uma iteração por linha de dados e emite um evento por requisição', async () => {
    const events: RunnerEvent[] = []
    await new Promise<void>((resolve) =>
      runCollection(
        ctx(),
        {
          runId: 'r',
          collection: demoCollection(srv.url),
          environment: demoEnv(),
          globals: [],
          iterations: 1,
          delayMs: 0,
          data: [{ nome: 'Ada' }, { nome: 'Grace' }],
          stopOnError: false,
          persistVariables: true
        },
        (e) => {
          events.push(e)
          if (e.type === 'done') resolve()
        }
      )
    )
    const items = events.filter((e) => e.type === 'item') as Extract<RunnerEvent, { type: 'item' }>[]
    expect(items).toHaveLength(8)
    expect(items.flatMap((i) => i.tests).every((t) => t.passed)).toBe(true)
    expect(events.some((e) => e.type === 'console' && e.entry.messages.join(' ').includes('Grace'))).toBe(true)
    const done = events.at(-1) as Extract<RunnerEvent, { type: 'done' }>
    expect(done.environment?.find((v) => v.key === 'firstId')?.value).toBe('1')
  })

  it('roda só a pasta escolhida', async () => {
    const names: string[] = []
    await new Promise<void>((resolve) =>
      runCollection(
        ctx(),
        {
          runId: 'f',
          collection: demoCollection(srv.url),
          folderId: DEMO_IDS.folder,
          environment: demoEnv(),
          globals: [],
          iterations: 1,
          delayMs: 0,
          stopOnError: false,
          persistVariables: false
        },
        (e) => {
          if (e.type === 'item') names.push(e.name)
          if (e.type === 'done') resolve()
        }
      )
    )
    expect(names).toEqual(['Listar usuários', 'Buscar usuário'])
  })
})

describe('proxy', () => {
  let proxy: http.Server
  let hits: string[] = []
  let proxyUrl = ''
  beforeAll(async () => {
    // proxy HTTP mínimo: recebe a URL absoluta e repassa
    proxy = http.createServer((req, res) => {
      hits.push(req.url || '')
      const target = new URL(req.url || '')
      const fwd = http.request(
        { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode || 502, { ...r.headers, 'x-via-test-proxy': '1' })
          r.pipe(res)
        }
      )
      req.pipe(fwd)
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()))
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => proxy.close(() => r())))

  it('passa pelo proxy manual', async () => {
    hits = []
    const r = await sendRequest(ctx({ proxy: { mode: 'custom', url: proxyUrl, bypass: '', username: '', password: '' } }), {
      runId: 'p',
      collection: demoCollection(srv.url),
      itemId: DEMO_IDS.list,
      environment: demoEnv(),
      globals: []
    })
    expect(r.response?.code).toBe(200)
    expect(hits).toEqual([`${srv.url}/users`])
    expect(r.response?.headers.find((h) => h.key === 'x-via-test-proxy')).toBeTruthy()
  })

  it('respeita a lista de exceções', async () => {
    hits = []
    const r = await sendRequest(ctx({ proxy: { mode: 'custom', url: proxyUrl, bypass: 'localhost, 127.0.0.1', username: '', password: '' } }), {
      runId: 'p2',
      collection: demoCollection(srv.url),
      itemId: DEMO_IDS.list,
      environment: demoEnv(),
      globals: []
    })
    expect(r.response?.code).toBe(200)
    expect(hits).toEqual([])
  })

  it('monta proxy com autenticação e porta padrão', () => {
    const list = buildProxies({ ...ctx().network, proxy: { mode: 'custom', url: 'socks5://10.0.0.1', bypass: '*.corp.com', username: 'u', password: 'p' } })
    const cfg = list.resolve('https://api.example.com/x')
    expect(cfg.host).toBe('10.0.0.1')
    expect(cfg.port).toBe(1080)
    expect(cfg.protocol).toBe('socks5')
    expect(cfg.authenticate).toBe(true)
    expect(list.resolve('https://a.corp.com/x')).toBeUndefined()
    expect(buildProxies(ctx().network)).toBeUndefined()
  })
})

describe('certificados', () => {
  it('associa o certificado ao host em qualquer porta', () => {
    const list = buildCertificates({
      ...ctx().network,
      clientCerts: [{ id: '1', host: '*.empresa.com', certPath: '/tmp/c.pem', keyPath: '/tmp/k.pem', pfxPath: '', passphrase: 'x' }]
    })
    expect(list.resolveOne('https://api.empresa.com:8443/v1')?.cert.src).toBe('/tmp/c.pem')
    expect(list.resolveOne('https://outra.com/')).toBeUndefined()
  })
})
