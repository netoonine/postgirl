import type { MockEvent, PMCollection } from '@shared/types'
import { MockServer, startMockServer } from '../core/mock'

const servers = new Map<string, MockServer>()

export async function startMock(collection: PMCollection, port: number, emit: (e: MockEvent) => void) {
  const id = collection.info._postman_id
  await stopMock(id, emit)
  try {
    const s = await startMockServer(collection, { port, onRequest: (entry) => emit({ collectionId: id, type: 'request', entry }) })
    servers.set(id, s)
    emit({ collectionId: id, type: 'status', running: true, port: s.port, routes: s.routes() })
    return { port: s.port, routes: s.routes() }
  } catch (e: any) {
    const error = e?.code === 'EADDRINUSE' ? `A porta ${port} já está em uso` : e?.message || String(e)
    emit({ collectionId: id, type: 'status', running: false, error })
    throw new Error(error)
  }
}

export function updateMock(collection: PMCollection, emit: (e: MockEvent) => void) {
  const s = servers.get(collection.info._postman_id)
  if (!s) return
  s.update(collection)
  emit({ collectionId: collection.info._postman_id, type: 'status', running: true, port: s.port, routes: s.routes() })
}

export async function stopMock(id: string, emit: (e: MockEvent) => void) {
  const s = servers.get(id)
  if (!s) return
  servers.delete(id)
  await s.close()
  emit({ collectionId: id, type: 'status', running: false })
}

export const mockStatus = () => [...servers.entries()].map(([collectionId, s]) => ({ collectionId, port: s.port, routes: s.routes() }))

export const stopAllMocks = () => Promise.all([...servers.values()].map((s) => s.close()))
