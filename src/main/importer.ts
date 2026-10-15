import { randomUUID } from 'crypto'
import type { Environment, ImportResult, PMCollection, PMItem, PMRequest } from '@shared/types'
import { COLLECTION_SCHEMA } from '@shared/types'
import { normalizeCollection } from './storage'

/* eslint-disable @typescript-eslint/no-var-requires */
const transformer = require('postman-collection-transformer')
const openapi = require('openapi-to-postmanv2')
const curl = require('curl-to-postmanv2')
const sdk = require('postman-collection')
/* eslint-enable @typescript-eslint/no-var-requires */

const p = <T>(fn: (cb: (e: any, r: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((e, r) => (e ? reject(e) : resolve(r))))

/** Converte a URL estruturada do Postman (string ou objeto) para o formato do editor. */
export function toEditorUrl(url: any) {
  if (!url) return { raw: '' }
  if (typeof url === 'string') {
    const parsed = sdk.Url.parse(url)
    return { raw: url, query: parsed.query || [], variable: parsed.variable || [] }
  }
  const raw = url.raw ?? new sdk.Url(url).toString()
  return { ...url, raw }
}

function fixItems(items: PMItem[] = []) {
  for (const it of items) {
    if (it.request) {
      if (typeof it.request === 'string') it.request = { method: 'GET', url: it.request as any, header: [] } as PMRequest
      it.request.url = toEditorUrl(it.request.url)
      it.request.header = it.request.header || []
      it.request.method = (it.request.method || 'GET').toUpperCase()
    }
    if (it.item) fixItems(it.item)
  }
}

function asCollection(json: any): PMCollection {
  let v2 = json
  if (transformer.isv1(json)) {
    v2 = transformer.convert(json, { inputVersion: '1.0.0', outputVersion: '2.1.0', retainIds: true })
  } else if (json.info?.schema?.includes('v2.0.0')) {
    v2 = transformer.convert(json, { inputVersion: '2.0.0', outputVersion: '2.1.0', retainIds: true })
  }
  // um _postman_id novo evita sobrescrever a coleção original se ela for importada duas vezes
  v2.info = { ...v2.info, _postman_id: randomUUID(), schema: COLLECTION_SCHEMA }
  fixItems(v2.item)
  return normalizeCollection(v2)
}

function asEnvironment(json: any): Environment {
  return {
    id: randomUUID(),
    name: json.name || 'Ambiente importado',
    values: (json.values || []).map((v: any) => ({
      key: v.key,
      value: v.value ?? '',
      enabled: v.enabled !== false,
      type: v.type === 'secret' ? 'secret' : 'default'
    }))
  }
}

async function fromOpenApi(text: string): Promise<PMCollection> {
  const r: any = await p((cb) =>
    openapi.convertV2({ type: 'string', data: text }, { folderStrategy: 'Tags', requestParametersResolution: 'Example' }, cb)
  )
  if (!r.result) throw new Error(r.reason || 'Especificação OpenAPI inválida')
  return asCollection(r.output[0].data)
}

/** cURL -> requisição avulsa dentro de uma coleção nova. */
export async function curlToRequest(text: string): Promise<PMRequest> {
  const r: any = await p((cb) => curl.convert({ type: 'string', data: text }, cb))
  if (!r.result) throw new Error(r.reason || 'Comando cURL inválido')
  const d = r.output[0].data
  const req: PMRequest = {
    method: (d.method || 'GET').toUpperCase(),
    header: d.header || [],
    url: toEditorUrl(d.url),
    body: d.body
  }
  // `-d '{"a":1}'` vira um campo urlencoded com o JSON inteiro na chave; corrigimos para raw JSON
  const ue = req.body?.mode === 'urlencoded' ? req.body.urlencoded : null
  if (ue && ue.length === 1 && !ue[0].value && /^\s*[[{]/.test(ue[0].key)) {
    req.body = { mode: 'raw', raw: ue[0].key, options: { raw: { language: 'json' } } }
  }
  return req
}

export async function importText(text: string, fileName = ''): Promise<ImportResult> {
  const out: ImportResult = { collections: [], environments: [], errors: [] }
  const trimmed = text.trim()

  if (/^curl\s/i.test(trimmed)) {
    const req = await curlToRequest(trimmed)
    out.collections.push(
      normalizeCollection({
        info: { _postman_id: randomUUID(), name: 'Importado do cURL', schema: COLLECTION_SCHEMA },
        item: [{ id: randomUUID(), name: req.url.raw.replace(/^https?:\/\//, '').slice(0, 60), request: req }]
      })
    )
    return out
  }

  let json: any = null
  try {
    json = JSON.parse(trimmed)
  } catch {
    // não é JSON: pode ser OpenAPI em YAML
  }

  try {
    if (!json) {
      if (/^(openapi|swagger)\s*:/m.test(trimmed)) out.collections.push(await fromOpenApi(trimmed))
      else out.errors.push(`${fileName || 'Texto'}: formato não reconhecido`)
    } else if (json.openapi || json.swagger) {
      out.collections.push(await fromOpenApi(trimmed))
    } else if (Array.isArray(json.collections) || Array.isArray(json.environments)) {
      // backup completo do Postman (Settings > Data > Export data)
      for (const c of json.collections || []) out.collections.push(asCollection(c))
      for (const e of json.environments || []) out.environments.push(asEnvironment(e))
    } else if (json.info || json.requests || json.order) {
      out.collections.push(asCollection(json))
    } else if (Array.isArray(json.values)) {
      out.environments.push(asEnvironment(json))
    } else {
      out.errors.push(`${fileName || 'Texto'}: JSON não é coleção, ambiente nem OpenAPI`)
    }
  } catch (e: any) {
    out.errors.push(`${fileName || 'Texto'}: ${e.message || e}`)
  }
  return out
}
