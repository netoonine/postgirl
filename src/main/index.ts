import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Environment, EnvValue, HistoryEntry, PMCollection, RunnerOptions, SendPayload, Settings } from '@shared/types'
import * as storage from './storage'
import * as cookies from './cookies'
import { cancelRun, sendRequest, startRunner } from './http'
import { generate, languages } from './codegen'
import { curlToRequest, importText } from './importer'
import { getToken, OAuth2Config } from './oauth2'
import * as rt from './realtime'

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Postgirl',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  // links da resposta (preview HTML, docs) abrem no navegador do sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload)

function buildMenu() {
  const menu = (id: string) => () => send('menu', id)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Arquivo',
        submenu: [
          { label: 'Nova requisição', accelerator: 'CmdOrCtrl+T', click: menu('new-request') },
          { label: 'Nova coleção', accelerator: 'CmdOrCtrl+Shift+N', click: menu('new-collection') },
          { label: 'Importar…', accelerator: 'CmdOrCtrl+O', click: menu('import') },
          { type: 'separator' },
          { label: 'Salvar', accelerator: 'CmdOrCtrl+S', click: menu('save') },
          { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: menu('close-tab') },
          { type: 'separator' },
          { label: 'Abrir pasta de trabalho no Finder', click: () => shell.openPath(storage.getSettings().workspacePath) },
          { label: 'Trocar pasta de trabalho…', click: menu('choose-workspace') },
          { label: 'Recarregar pasta de trabalho', accelerator: 'CmdOrCtrl+Shift+R', click: menu('reload-workspace') }
        ]
      },
      { role: 'editMenu' },
      {
        label: 'Visualizar',
        submenu: [
          { label: 'Console', accelerator: 'CmdOrCtrl+Alt+C', click: menu('toggle-console') },
          { label: 'Barra lateral', accelerator: 'CmdOrCtrl+\\', click: menu('toggle-sidebar') },
          { label: 'Configurações', accelerator: 'CmdOrCtrl+,', click: menu('settings') },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}

function registerIpc() {
  ipcMain.handle('workspace:load', () => {
    const ws = storage.loadWorkspace()
    cookies.resetJar()
    return ws
  })
  ipcMain.handle('workspace:choose', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Escolha a pasta de trabalho',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    storage.saveSettings({ workspacePath: r.filePaths[0] })
    cookies.resetJar()
    return storage.loadWorkspace()
  })
  ipcMain.handle('settings:save', (_e, s: Partial<Settings>) => {
    const next = storage.saveSettings(s)
    nativeTheme.themeSource = next.theme
    return next
  })

  ipcMain.handle('collection:save', (_e, c: PMCollection) => storage.saveCollection(c))
  ipcMain.handle('collection:delete', (_e, id: string) => storage.deleteCollection(id))
  ipcMain.handle('environment:save', (_e, env: Environment) => storage.saveEnvironment(env))
  ipcMain.handle('environment:delete', (_e, id: string) => storage.deleteEnvironment(id))
  ipcMain.handle('globals:save', (_e, values: EnvValue[]) => storage.saveGlobals(values))
  ipcMain.handle('history:add', (_e, h: HistoryEntry) => storage.addHistory(h))
  ipcMain.handle('history:clear', () => storage.clearHistory())

  ipcMain.handle('http:send', (_e, p: SendPayload) => sendRequest(p))
  ipcMain.handle('http:cancel', (_e, runId: string) => cancelRun(runId))
  ipcMain.handle('runner:start', (_e, o: RunnerOptions) => startRunner(o, (ev) => send('runner:event', ev)))
  ipcMain.handle('runner:stop', (_e, runId: string) => cancelRun(runId))

  ipcMain.handle('cookies:list', () => cookies.listCookies())
  ipcMain.handle('cookies:delete', (_e, d: string, p: string, k: string) => cookies.deleteCookie(d, p, k))
  ipcMain.handle('cookies:clear', (_e, domain?: string) => cookies.clearCookies(domain))

  ipcMain.handle('codegen:languages', () => languages())
  ipcMain.handle('codegen:generate', (_e, o) => generate(o))
  ipcMain.handle('import:text', (_e, text: string, name?: string) => importText(text, name))
  ipcMain.handle('import:curl', (_e, text: string) => curlToRequest(text))
  ipcMain.handle('import:files', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Importar coleções, ambientes ou OpenAPI',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JSON / YAML', extensions: ['json', 'yaml', 'yml'] }]
    })
    if (r.canceled) return null
    const merged = { collections: [] as PMCollection[], environments: [] as Environment[], errors: [] as string[] }
    for (const f of r.filePaths) {
      const res = await importText(fs.readFileSync(f, 'utf8'), path.basename(f))
      merged.collections.push(...res.collections)
      merged.environments.push(...res.environments)
      merged.errors.push(...res.errors)
    }
    return merged
  })
  ipcMain.handle('oauth2:token', (_e, c: OAuth2Config) => getToken(c))

  ipcMain.handle('dialog:open-file', async (_e, o: { title?: string; extensions?: string[]; multi?: boolean } = {}) => {
    const r = await dialog.showOpenDialog(win!, {
      title: o.title,
      properties: o.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: o.extensions ? [{ name: o.extensions.join(', '), extensions: o.extensions }] : undefined
    })
    return r.canceled ? null : o.multi ? r.filePaths : r.filePaths[0]
  })
  ipcMain.handle('dialog:save-file', async (_e, defaultName: string, content: string, base64 = false) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName })
    if (r.canceled || !r.filePath) return false
    fs.writeFileSync(r.filePath, base64 ? Buffer.from(content, 'base64') : content)
    return true
  })
  ipcMain.handle('file:read-text', (_e, p: string) => fs.readFileSync(p, 'utf8'))

  ipcMain.handle('rt:ws', (_e, o) => rt.wsConnect(o, (ev) => send('rt:event', ev)))
  ipcMain.handle('rt:io', (_e, o) => rt.ioConnect(o, (ev) => send('rt:event', ev)))
  ipcMain.handle('rt:mqtt', (_e, o) => rt.mqttConnect(o, (ev) => send('rt:event', ev)))
  ipcMain.handle('rt:grpc-load', (_e, o) => rt.grpcLoad(o))
  ipcMain.handle('rt:grpc-invoke', (_e, o) => rt.grpcInvoke(o, (ev) => send('rt:event', ev)))
  ipcMain.handle('rt:send', (_e, connId: string, data: string, opts?: any) => rt.send(connId, data, opts))
  ipcMain.handle('rt:end', (_e, connId: string) => rt.endStream(connId))
  ipcMain.handle('rt:disconnect', (_e, connId: string) => rt.disconnect(connId))
}

app.setName('Postgirl')
// pasta de dados alternativa (testes automatizados, perfis separados)
if (process.env.POSTGIRL_USER_DATA) app.setPath('userData', process.env.POSTGIRL_USER_DATA)
app.whenReady().then(() => {
  nativeTheme.themeSource = storage.loadWorkspace().settings.theme
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
