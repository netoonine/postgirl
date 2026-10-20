// Teste ponta a ponta: abre o app de verdade (Electron) e usa a interface como uma pessoa usaria.
// Rode `npm run build` antes: o teste usa o que está em out/.
//   npm run test:e2e
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { startTestServer } from '../server.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixtures = path.join(root, 'test/fixtures')
const shots = process.env.E2E_SCREENSHOTS

let srv, app, page, userData, ws

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }))

before(async () => {
  srv = await startTestServer(0)
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'postgirl-e2e-'))
  ws = path.join(userData, 'workspace')
  fs.mkdirSync(path.join(ws, 'collections'), { recursive: true })
  fs.mkdirSync(path.join(ws, 'environments'), { recursive: true })
  const col = readJson(path.join(fixtures, 'demo.postman_collection.json'))
  col.variable = [{ key: 'baseUrl', value: srv.url }]
  fs.writeFileSync(path.join(ws, 'collections', 'demo.postman_collection.json'), JSON.stringify(col, null, 2))
  fs.copyFileSync(path.join(fixtures, 'demo.postman_environment.json'), path.join(ws, 'environments', 'local.postman_environment.json'))
  if (shots) fs.mkdirSync(shots, { recursive: true })

  app = await electron.launch({
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, POSTGIRL_USER_DATA: userData, POSTGIRL_DISABLE_KEYCHAIN: '1', ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('text=Demo Postgirl')
})

after(async () => {
  await app?.close()
  await srv?.close()
  fs.rmSync(userData, { recursive: true, force: true })
})

test('envia uma requisição da coleção com o ambiente ativo e roda os testes', async () => {
  await page.locator('.topbar select').selectOption({ label: 'Local' })
  await page.locator('.tree-row', { hasText: 'Demo Postgirl' }).click()
  await page.locator('.tree-row', { hasText: 'Usuários' }).first().click()
  await page.locator('.tree-row', { hasText: 'Listar usuários' }).click()
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await page.locator('.resp-meta', { hasText: '200 OK' }).waitFor()
  await page.locator('.subtab', { hasText: 'Testes' }).locator('text=2/2').waitFor()
  await shot('01-requisicao')
})

test('a busca rápida (⌘K) abre requisições pelo nome', async () => {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await page.locator('.palette input').fill('buscar usu')
  await shot('02-busca')
  await page.keyboard.press('Enter')
  await page.locator('.tab', { hasText: 'Buscar usuário' }).waitFor()
  assert.equal(await page.locator('.palette').count(), 0)
})

test('o mock server responde com os exemplos salvos', async () => {
  await page.locator('.tree-row', { hasText: 'Demo Postgirl' }).dblclick()
  await page.locator('.subtab', { hasText: 'Mock server' }).click()
  await page.locator('input[type=number]').fill('0')
  await page.getByRole('button', { name: 'Iniciar mock' }).click()
  const url = await page.locator('.mono', { hasText: 'http://localhost:' }).textContent()
  const r = await fetch(`${url}/users/42`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { id: 1, name: 'Ada' })
  await page.locator('td', { hasText: '/users/42' }).waitFor()
  await shot('03-mock')
  await page.getByRole('button', { name: 'Parar' }).click()
})

test('valores secretos não vão para o arquivo do ambiente', async () => {
  // qualquer edição regrava o ambiente; o token (secreto) deve sair do arquivo e ir para o cofre
  await page.locator('.rail-btn', { hasText: 'Ambientes' }).click()
  await page.locator('.tree-row', { hasText: 'Local' }).click()
  const nome = page.locator('input[value="sem dados"]')
  await nome.fill('alterado')
  await page.waitForTimeout(900)
  const file = fs.readdirSync(path.join(ws, 'environments')).find((f) => f.includes('local'))
  const env = readJson(path.join(ws, 'environments', file))
  assert.equal(env.values.find((v) => v.key === 'token').value, '')
  assert.equal(env.values.find((v) => v.key === 'nome').value, 'alterado')
  const vault = readJson(path.join(userData, 'secrets.json'))
  assert.ok(Object.keys(vault.scopes).some((k) => k.startsWith('env:')))
  // o app continua vendo o valor real
  await page.locator('.topbar').getByTitle('Ver variáveis').click()
  await shot('04-ambiente')
  await page.locator('.topbar').getByTitle('Ver variáveis').click()
})

test('alterações feitas por fora do app (git pull) aparecem sozinhas', async () => {
  await page.locator('.rail-btn', { hasText: 'Coleções' }).click()
  const dir = path.join(ws, 'collections')
  const file = path.join(
    dir,
    fs.readdirSync(dir).find((f) => f.endsWith('.json'))
  )
  const col = readJson(file)
  col.item[1].name = 'Renomeado no disco'
  fs.writeFileSync(file, JSON.stringify(col, null, 2))
  await page.locator('.tree-row', { hasText: 'Renomeado no disco' }).waitFor({ timeout: 5000 })
  await shot('05-sync')
})

test('configurações de proxy e certificados', async () => {
  await page
    .locator('.topbar')
    .getByTitle(/Configurações/)
    .click()
  await page.locator('.modal .subtab', { hasText: 'Proxy' }).click()
  await page.locator('.modal select').selectOption('custom')
  await page.locator('.modal input[placeholder^="http://proxy"]').fill('http://127.0.0.1:3128')
  await page.locator('.modal .subtab', { hasText: 'Certificados' }).click()
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await shot('06-certificados')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const settings = readJson(path.join(userData, 'settings.json'))
  assert.equal(settings.proxy.mode, 'custom')
  assert.equal(settings.proxy.url, 'http://127.0.0.1:3128')
  assert.equal(settings.clientCerts.length, 1)
})
