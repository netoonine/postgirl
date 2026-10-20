import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildRoutes, matchRoute, MockServer, pathSegments, startMockServer } from '../../src/core/mock'
import { demoCollection } from './helpers'

describe('pathSegments', () => {
  it.each([
    ['{{baseUrl}}/users/:id?x=1', ['users', ':id']],
    ['https://api.x.com/v1/users', ['v1', 'users']],
    ['localhost:3000/a/b', ['a', 'b']],
    ['api.x.com/a', ['a']],
    ['/plain/path', ['plain', 'path']],
    ['{{host}}', []]
  ])('%s', (raw, segs) => expect(pathSegments(raw)).toEqual(segs))
})

describe('matchRoute', () => {
  const routes = buildRoutes(demoCollection('http://x'))
  it('usa o exemplo de sucesso por padrão e aceita qualquer valor em :id', () => {
    expect(matchRoute(routes, 'GET', '/users/99', new URLSearchParams())?.example.name).toBe('Ada')
  })
  it('escolhe pelo código ou nome via header', () => {
    expect(matchRoute(routes, 'GET', '/users/1', new URLSearchParams(), { 'x-mock-response-code': '404' })?.example.code).toBe(404)
    expect(matchRoute(routes, 'GET', '/users/1', new URLSearchParams(), { 'x-mock-response-name': 'Não encontrado' })?.example.code).toBe(404)
  })
  it('prefere o caminho literal ao variável', () => {
    expect(matchRoute(routes, 'GET', '/users', new URLSearchParams())?.example.name).toBe('Dois usuários')
  })
  it('não casa método ou tamanho diferentes', () => {
    expect(matchRoute(routes, 'POST', '/users', new URLSearchParams())).toBeNull()
    expect(matchRoute(routes, 'GET', '/users/1/extra', new URLSearchParams())).toBeNull()
  })
})

describe('servidor', () => {
  let s: MockServer
  const log: any[] = []
  beforeAll(async () => {
    s = await startMockServer(demoCollection('http://x'), { port: 0, onRequest: (e) => log.push(e) })
  })
  afterAll(() => s.close())

  it('responde com o corpo, status e headers do exemplo, com CORS', async () => {
    const r = await fetch(`http://127.0.0.1:${s.port}/users`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/json')
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
    expect(await r.json()).toHaveLength(2)
  })

  it('devolve 404 explicando as rotas quando nada corresponde', async () => {
    const r = await fetch(`http://127.0.0.1:${s.port}/nada`)
    expect(r.status).toBe(404)
    const j = await r.json()
    expect(j.rotas.length).toBe(3)
  })

  it('responde ao preflight CORS', async () => {
    const r = await fetch(`http://127.0.0.1:${s.port}/users`, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', origin: 'http://app' } })
    expect(r.status).toBe(204)
  })

  it('atualiza as rotas sem reiniciar e registra as chamadas', async () => {
    const c = demoCollection('http://x')
    c.item = c.item.slice(0, 1)
    c.item[0].item = c.item[0].item!.slice(0, 1)
    s.update(c)
    expect(s.routes()).toBe(1)
    expect(log.some((e) => e.path === '/nada' && e.code === 404)).toBe(true)
  })
})
