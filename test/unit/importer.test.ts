import { describe, expect, it } from 'vitest'
import { curlToRequest, importText } from '../../src/core/importer'
import { parseCsv } from '@shared/csv'

describe('importText', () => {
  it('importa um comando cURL com JSON no corpo', async () => {
    const r = await importText(`curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"Ada"}'`)
    const req = r.collections[0]?.item[0]?.request
    expect(req?.method).toBe('POST')
    expect(req?.body?.mode).toBe('raw')
    expect(JSON.parse(req!.body!.raw!)).toEqual({ name: 'Ada' })
  })

  it('importa OpenAPI 3 em YAML', async () => {
    const yaml = [
      'openapi: 3.0.0',
      'info: { title: Pets, version: "1" }',
      'servers: [{ url: "https://pets.example.com" }]',
      'paths:',
      '  /pets:',
      '    get:',
      '      summary: Lista pets',
      '      responses: { "200": { description: ok } }',
      '  /pets/{id}:',
      '    delete:',
      '      summary: Remove pet',
      '      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]',
      '      responses: { "204": { description: ok } }'
    ].join('\n')
    const r = await importText(yaml, 'pets.yaml')
    expect(r.errors).toEqual([])
    expect(r.collections[0].info.name).toBe('Pets')
    const names: string[] = []
    const walk = (items: any[]) => items.forEach((i) => (i.item ? walk(i.item) : names.push(`${i.request.method} ${i.name}`)))
    walk(r.collections[0].item)
    expect(names.sort()).toEqual(['DELETE Remove pet', 'GET Lista pets'])
  })

  it('importa ambiente do Postman', async () => {
    const r = await importText(JSON.stringify({ name: 'Prod', values: [{ key: 'a', value: '1', enabled: true }], _postman_variable_scope: 'environment' }))
    expect(r.environments[0].name).toBe('Prod')
    expect(r.environments[0].values[0].key).toBe('a')
  })

  it('garante ids em todos os itens de uma coleção v2.1', async () => {
    const r = await importText(
      JSON.stringify({
        info: { name: 'X', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [{ name: 'a', item: [{ name: 'b', request: { method: 'GET', url: 'http://x' } }] }]
      })
    )
    expect(r.collections[0].item[0].id).toBeTruthy()
    expect(r.collections[0].item[0].item![0].id).toBeTruthy()
  })

  it('reporta texto que não reconhece', async () => {
    const r = await importText('isso não é nada')
    expect(r.collections).toEqual([])
    expect(r.errors.length).toBeGreaterThan(0)
  })
})

describe('curlToRequest', () => {
  it('lê headers e basic auth', async () => {
    const req = await curlToRequest(`curl -u ada:secret -H 'X-Trace: 1' https://api.example.com/me`)
    expect(req.url.raw).toContain('https://api.example.com/me')
    expect(req.header.find((h) => h.key === 'X-Trace')?.value).toBe('1')
  })
})

describe('parseCsv', () => {
  it('lida com aspas, vírgulas e CRLF', () => {
    expect(parseCsv('nome,obs\r\n"Silva, Ana","disse ""oi"""\r\nBia,\r\n')).toEqual([
      { nome: 'Silva, Ana', obs: 'disse "oi"' },
      { nome: 'Bia', obs: '' }
    ])
  })
})
