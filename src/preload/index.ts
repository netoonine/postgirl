import { contextBridge, ipcRenderer, webUtils } from 'electron'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const on = (channel: string) => (cb: (payload: any) => void) => {
  const listener = (_e: unknown, payload: any) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  loadWorkspace: invoke('workspace:load'),
  chooseWorkspace: invoke('workspace:choose'),
  saveSettings: invoke('settings:save'),
  saveCollection: invoke('collection:save'),
  deleteCollection: invoke('collection:delete'),
  saveEnvironment: invoke('environment:save'),
  deleteEnvironment: invoke('environment:delete'),
  saveGlobals: invoke('globals:save'),
  addHistory: invoke('history:add'),
  clearHistory: invoke('history:clear'),
  send: invoke('http:send'),
  cancel: invoke('http:cancel'),
  runnerStart: invoke('runner:start'),
  runnerStop: invoke('runner:stop'),
  onRunnerEvent: on('runner:event'),
  listCookies: invoke('cookies:list'),
  deleteCookie: invoke('cookies:delete'),
  clearCookies: invoke('cookies:clear'),
  codegenLanguages: invoke('codegen:languages'),
  codegen: invoke('codegen:generate'),
  importText: invoke('import:text'),
  importCurl: invoke('import:curl'),
  importFiles: invoke('import:files'),
  oauth2Token: invoke('oauth2:token'),
  openFile: invoke('dialog:open-file'),
  saveFile: invoke('dialog:save-file'),
  readText: invoke('file:read-text'),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  onMenu: on('menu'),
  onWorkspaceChanged: on('workspace:changed'),
  mock: {
    start: invoke('mock:start'),
    update: invoke('mock:update'),
    stop: invoke('mock:stop'),
    status: invoke('mock:status'),
    onEvent: on('mock:event')
  },
  rt: {
    ws: invoke('rt:ws'),
    io: invoke('rt:io'),
    mqtt: invoke('rt:mqtt'),
    grpcLoad: invoke('rt:grpc-load'),
    grpcInvoke: invoke('rt:grpc-invoke'),
    send: invoke('rt:send'),
    end: invoke('rt:end'),
    disconnect: invoke('rt:disconnect'),
    onEvent: on('rt:event')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
