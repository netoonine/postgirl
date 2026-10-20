import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Folder, Layers, Search, Settings, Terminal, Upload, Plus, Cookie, FolderOpen, Library } from 'lucide-react'
import {
  createCollection,
  openCollectionTab,
  openEnvironmentTab,
  openGlobalsTab,
  openItem,
  openModal,
  openNewRequest,
  setActiveEnv,
  setPalette,
  toggleConsole,
  useStore
} from '../store'
import { methodColor } from '../util'

interface Entry {
  id: string
  title: string
  detail?: string
  badge?: ReactNode
  icon?: ReactNode
  keywords: string
  run: () => void
}

/** Busca rápida (⌘K): requisições de todas as coleções, ambientes e comandos. */
export function Palette() {
  const open = useStore((s) => s.paletteOpen)
  if (!open) return null
  return <PaletteInner />
}

function PaletteInner() {
  const collections = useStore((s) => s.collections)
  const environments = useStore((s) => s.environments)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => {
    const out: Entry[] = []
    for (const c of collections) {
      const id = c.info._postman_id
      out.push({ id: `c:${id}`, title: c.info.name, detail: 'Coleção', icon: <Library size={14} />, keywords: c.info.name, run: () => openCollectionTab(id) })
      const walk = (items: typeof c.item, path: string[]) => {
        for (const it of items) {
          const where = [c.info.name, ...path].join(' / ')
          if (it.item) {
            out.push({
              id: `f:${it.id}`,
              title: it.name,
              detail: where,
              icon: <Folder size={14} />,
              keywords: `${where} ${it.name}`,
              run: () => openItem(id, it.id)
            })
            walk(it.item, [...path, it.name])
          } else {
            const method = it.postwoman ? it.postwoman.protocol.toUpperCase() : it.request?.method || 'GET'
            const url = it.request?.url?.raw || it.postwoman?.config?.url || ''
            out.push({
              id: `r:${it.id}`,
              title: it.name,
              detail: `${where} · ${url}`,
              badge: (
                <span className="method-badge" style={{ color: methodColor(method) }}>
                  {method.slice(0, 6)}
                </span>
              ),
              keywords: `${where} ${it.name} ${method} ${url}`,
              run: () => openItem(id, it.id)
            })
          }
        }
      }
      walk(c.item, [])
    }
    for (const e of environments) {
      out.push({
        id: `e:${e.id}`,
        title: e.name,
        detail: 'Ambiente · editar',
        icon: <Layers size={14} />,
        keywords: `ambiente ${e.name}`,
        run: () => openEnvironmentTab(e.id)
      })
      out.push({
        id: `ea:${e.id}`,
        title: `Usar ambiente “${e.name}”`,
        icon: <Layers size={14} />,
        keywords: `usar ativar ambiente ${e.name}`,
        run: () => setActiveEnv(e.id)
      })
    }
    const cmd = (id: string, title: string, icon: ReactNode, run: () => void, keywords = '') =>
      out.push({ id: `cmd:${id}`, title, detail: 'Comando', icon, keywords: `${title} ${keywords}`, run })
    cmd('new', 'Nova requisição HTTP', <Plus size={14} />, () => openNewRequest('http'), 'criar')
    cmd('new-col', 'Nova coleção', <Plus size={14} />, createCollection, 'criar')
    cmd('import', 'Importar…', <Upload size={14} />, () => openModal('import'), 'curl openapi postman')
    cmd('globals', 'Variáveis globais', <Layers size={14} />, openGlobalsTab)
    cmd('console', 'Mostrar/ocultar console', <Terminal size={14} />, toggleConsole)
    cmd('cookies', 'Cookies', <Cookie size={14} />, () => openModal('cookies'))
    cmd('settings', 'Configurações', <Settings size={14} />, () => openModal('settings'), 'proxy certificado ssl tema')
    cmd('ws', 'Novo WebSocket', <Plus size={14} />, () => openNewRequest('websocket'))
    cmd('grpc', 'Novo gRPC', <Plus size={14} />, () => openNewRequest('grpc'))
    cmd('mqtt', 'Novo MQTT', <Plus size={14} />, () => openNewRequest('mqtt'))
    cmd('io', 'Novo Socket.IO', <Plus size={14} />, () => openNewRequest('socketio'))
    cmd('folder', 'Pasta de trabalho…', <FolderOpen size={14} />, () => openModal('settings'), 'workspace')
    return out
  }, [collections, environments])

  const shown = useMemo(() => {
    const terms = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean)
    if (!terms.length) return entries.filter((e) => e.id.startsWith('r:') || e.id.startsWith('cmd:')).slice(0, 60)
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return entries
      .map((e) => {
        const k = norm(e.keywords)
        const t = norm(e.title)
        if (!terms.every((x) => k.includes(x))) return null
        // título começando pelo termo vale mais; requisições antes de comandos
        const score = terms.reduce((a, x) => a + (t.startsWith(x) ? 4 : t.includes(x) ? 2 : 1), 0) + (e.id.startsWith('r:') ? 0.5 : 0)
        return { e, score }
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score)
      .slice(0, 60)
      .map((x) => x!.e)
  }, [q, entries])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (e?: Entry) => {
    if (!e) return
    setPalette(false)
    e.run()
  }

  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Buscar">
        <div className="palette-input">
          <Search size={15} />
          <input
            autoFocus
            placeholder="Buscar requisições, coleções, ambientes e comandos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPalette(false)
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(shown.length - 1, s + 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
              if (e.key === 'Enter') choose(shown[sel])
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {shown.length === 0 && <div className="empty-hint">Nada encontrado para “{q}”.</div>}
          {shown.map((e, i) => (
            <div key={e.id} className={`palette-item${i === sel ? ' active' : ''}`} onMouseMove={() => setSel(i)} onClick={() => choose(e)}>
              <span className="palette-icon">{e.badge || e.icon}</span>
              <span className="palette-title">{e.title}</span>
              {e.detail && <span className="palette-detail">{e.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
