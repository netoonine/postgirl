import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { main, parseArgs } from '../../src/cli/index'
import { fixture, startServer, TestServer } from './helpers'

let srv: TestServer
let tmp: string
beforeAll(async () => {
  srv = await startServer()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postwoman-cli-'))
})
afterAll(async () => {
  await srv.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const run = (...args: string[]) => main(['run', fixture('demo.postman_collection.json'), '--silent', '--env-var', `baseUrl=${srv.url}`, ...args])

describe('parseArgs', () => {
  it('entende aliases, flags, opções repetidas e --x=y', () => {
    expect(parseArgs(['run', 'c.json', '-e', 'env.json', '--env-var', 'a=1', '--env-var=b=2', '-k', '--bail', '-n', '3'])).toEqual({
      _: ['run', 'c.json'],
      environment: 'env.json',
      'env-var': ['a=1', 'b=2'],
      insecure: true,
      bail: true,
      'iteration-count': '3'
    })
  })
  it('reclama de opção sem valor', () => expect(() => parseArgs(['run', '-e'])).toThrow(/precisa de um valor/))
})

describe('postwoman run', () => {
  it('sai com 0 quando tudo passa e grava JUnit e JSON', async () => {
    const junit = path.join(tmp, 'r.xml')
    const json = path.join(tmp, 'r.json')
    const env = path.join(tmp, 'env-out.json')
    const code = await run(
      '-e',
      fixture('demo.postman_environment.json'),
      '-d',
      fixture('demo-data.csv'),
      '-r',
      'junit,json',
      '--reporter-junit-export',
      junit,
      '--reporter-json-export',
      json,
      '--export-environment',
      env
    )
    expect(code).toBe(0)
    expect(fs.readFileSync(junit, 'utf8')).toContain('<testsuites name="Demo Postwoman" tests="10" failures="0"')
    const report = JSON.parse(fs.readFileSync(json, 'utf8'))
    expect(report.summary.passed).toBe(10)
    expect(report.items).toHaveLength(8)
    expect(JSON.parse(fs.readFileSync(env, 'utf8')).values.find((v: any) => v.key === 'firstId').value).toBe('1')
  })

  it('sai com 1 quando um teste falha', async () => {
    // sem ambiente: token e nome ficam indefinidos e dois testes falham
    expect(await run()).toBe(1)
  })

  it('sai com 2 em erro de uso', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await main(['run', 'nao-existe', '-w', tmp])).toBe(2)
    expect(await main(['voar'])).toBe(2)
    err.mockRestore()
  })

  it('acha coleção e ambiente pelo nome na pasta de trabalho', async () => {
    fs.mkdirSync(path.join(tmp, 'collections'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'environments'), { recursive: true })
    fs.copyFileSync(fixture('demo.postman_collection.json'), path.join(tmp, 'collections', 'demo.postman_collection.json'))
    fs.copyFileSync(fixture('demo.postman_environment.json'), path.join(tmp, 'environments', 'local.postman_environment.json'))
    const code = await main(['run', 'demo postwoman', '-w', tmp, '-e', 'Local', '--folder', 'Usuários', '--silent', '--env-var', `baseUrl=${srv.url}`])
    expect(code).toBe(0)
  })
})
