import fs from 'fs'
import path from 'path'
import type { Environment, NetworkSettings, PMCollection } from '@shared/types'
import { DEFAULT_NETWORK } from '@shared/types'
import type { EngineContext } from '../../src/core/engine'
// @ts-expect-error módulo JS sem tipos
import { startTestServer } from '../server.mjs'

export type TestServer = { port: number; url: string; wsUrl: string; close: () => Promise<void> }
export const startServer = (): Promise<TestServer> => startTestServer(0)

export const fixture = (name: string) => path.join(__dirname, '..', 'fixtures', name)

export function demoCollection(baseUrl: string): PMCollection {
  const c = JSON.parse(fs.readFileSync(fixture('demo.postman_collection.json'), 'utf8'))
  c.variable = [{ key: 'baseUrl', value: baseUrl }]
  return c
}

export function demoEnv(): Environment {
  const e = JSON.parse(fs.readFileSync(fixture('demo.postman_environment.json'), 'utf8'))
  return { id: e.id, name: e.name, values: e.values }
}

export const ctx = (network: Partial<NetworkSettings> = {}): EngineContext => ({
  userAgent: 'Postgirl-Test',
  network: { ...DEFAULT_NETWORK, proxy: { ...DEFAULT_NETWORK.proxy }, ...network }
})

export const DEMO_IDS = {
  list: 'c3f2a0b1-0000-4000-8000-000000000002',
  get: 'c3f2a0b1-0000-4000-8000-000000000003',
  bearer: 'c3f2a0b1-0000-4000-8000-000000000004',
  post: 'c3f2a0b1-0000-4000-8000-000000000005',
  folder: 'c3f2a0b1-0000-4000-8000-000000000001'
}
