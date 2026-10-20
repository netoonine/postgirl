import { randomUUID } from 'crypto'
import type { PMCollection, PMItem } from '@shared/types'
import { COLLECTION_SCHEMA } from '@shared/types'

/** Garante ids em todos os itens: o Postgirl identifica requisições e pastas por id. */
function ensureIds(items: PMItem[] = []) {
  for (const it of items) {
    if (!it.id) it.id = randomUUID()
    if (it.item) ensureIds(it.item)
  }
}

export function normalizeCollection(c: PMCollection): PMCollection {
  c.info = c.info || ({} as PMCollection['info'])
  c.info._postman_id = c.info._postman_id || randomUUID()
  c.info.name = c.info.name || 'Nova coleção'
  c.info.schema = COLLECTION_SCHEMA
  c.item = c.item || []
  ensureIds(c.item)
  return c
}

/** No schema v2.1, "herdar do pai" é a ausência do campo auth. */
export function stripInherit(items: PMItem[] = []) {
  for (const it of items) {
    if (it.auth?.type === 'inherit') delete it.auth
    if (it.request?.auth?.type === 'inherit') delete it.request.auth
    if (it.item) stripInherit(it.item)
  }
}

/** Percorre todas as requisições (não pastas), com o caminho de pastas até elas. */
export function eachRequest(items: PMItem[] = [], fn: (it: PMItem, path: string[]) => void, path: string[] = []) {
  for (const it of items) {
    if (it.item) eachRequest(it.item, fn, [...path, it.name])
    else fn(it, path)
  }
}
