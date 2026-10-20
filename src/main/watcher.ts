// Observa a pasta de trabalho e avisa quando algo muda por fora do app (git pull, editor, outro processo).
import fs from 'fs'
import path from 'path'
import { isOwnChange } from './storage'

let watcher: fs.FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

const relevant = (rel: string) =>
  !rel.endsWith('.tmp') && (/^(collections|environments)[/\\][^/\\]+\.json$/.test(rel) || rel === 'globals.postman_globals.json')

export function watchWorkspace(dir: string, onChange: (files: string[]) => void) {
  stopWatching()
  const changed = new Set<string>()
  try {
    watcher = fs.watch(dir, { recursive: true }, (_event, name) => {
      if (!name) return
      const rel = name.toString()
      if (!relevant(rel)) return
      changed.add(rel)
      if (timer) clearTimeout(timer)
      // espera a rajada de eventos (um git checkout mexe em vários arquivos) antes de avisar
      timer = setTimeout(() => {
        const external = [...changed].filter((f) => !isOwnChange(path.join(dir, f)))
        changed.clear()
        if (external.length) onChange(external)
      }, 400)
    })
    watcher.on('error', () => stopWatching())
  } catch {
    // sem suporte a watch recursivo: o menu "Recarregar pasta de trabalho" continua disponível
    watcher = null
  }
}

export function stopWatching() {
  watcher?.close()
  watcher = null
  if (timer) clearTimeout(timer)
  timer = null
}
