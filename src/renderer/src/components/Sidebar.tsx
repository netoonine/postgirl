import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Layers,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload
} from 'lucide-react'
import type { PMCollection, PMItem } from '@shared/types'
import {
  addFolder,
  addRequest,
  clearHistory,
  createCollection,
  createEnvironment,
  deleteCollection,
  deleteEnvironment,
  deleteItem,
  duplicateCollection,
  duplicateEnvironment,
  duplicateItem,
  exportCollection,
  exportEnvironment,
  moveItem,
  openCollectionTab,
  openEnvironmentTab,
  openFolderTab,
  openFromHistory,
  openGlobalsTab,
  openItem,
  openModal,
  openRunner,
  renameCollection,
  renameItem,
  setActiveEnv,
  toggleExpanded,
  useStore
} from '../store'
import { dayLabel, isFolder, methodColor, timeAgo } from '../util'
import { MenuItem, useMenu, useResizable } from './ui'

const PROTOCOL_BADGE: Record<string, [string, string]> = {
  websocket: ['WS', 'var(--m-head)'],
  socketio: ['SIO', 'var(--m-patch)'],
  mqtt: ['MQTT', 'var(--m-options)'],
  grpc: ['gRPC', 'var(--m-put)']
}

export function ItemBadge({ item }: { item: PMItem }) {
  if (item.relay) {
    const [label, color] = PROTOCOL_BADGE[item.relay.protocol]
    return (
      <span className="method-badge" style={{ color }}>
        {label}
      </span>
    )
  }
  const m = item.request?.method || 'GET'
  return (
    <span className="method-badge" style={{ color: methodColor(m) }}>
      {m === 'DELETE' ? 'DEL' : m === 'OPTIONS' ? 'OPT' : m}
    </span>
  )
}

function matches(it: PMItem, q: string): boolean {
  if (!q) return true
  if (it.name.toLowerCase().includes(q) || it.request?.url?.raw?.toLowerCase().includes(q)) return true
  return !!it.item?.some((c) => matches(c, q))
}

// estado de arrastar compartilhado entre linhas (DataTransfer não é legível no dragover)
let dragging: { colId: string; itemId: string } | null = null

function useDrop(colId: string, targetId: string | null, folder: boolean) {
  const [zone, setZone] = useState<'before' | 'after' | 'inside' | null>(null)
  return {
    zone,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!dragging) return
        e.preventDefault()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const y = (e.clientY - r.top) / r.height
        setZone(!targetId ? 'inside' : folder ? (y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside') : y < 0.5 ? 'before' : 'after')
      },
      onDragLeave: () => setZone(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        if (dragging && zone) moveItem(dragging.colId, dragging.itemId, colId, targetId, zone)
        dragging = null
        setZone(null)
      }
    }
  }
}

function TreeItem({ col, item, depth, q }: { col: PMCollection; item: PMItem; depth: number; q: string }) {
  const colId = col.info._postman_id
  const expanded = useStore((s) => s.expanded[item.id]) || !!q
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.itemId === item.id)
  const menu = useMenu()
  const folder = isFolder(item)
  const drop = useDrop(colId, item.id, folder)
  if (!matches(item, q)) return null

  const items: MenuItem[] = folder
    ? [
        { label: 'Nova requisição', icon: <Plus size={14} />, onClick: () => addRequest(colId, item.id) },
        { label: 'Nova pasta', icon: <FolderPlus size={14} />, onClick: () => addFolder(colId, item.id) },
        { label: 'Executar pasta', icon: <Play size={14} />, onClick: () => openRunner(colId, item.id) },
        { label: 'Configurações da pasta', icon: <Settings2 size={14} />, onClick: () => openFolderTab(colId, item.id) },
        { sep: true },
        { label: 'Renomear', icon: <Pencil size={14} />, onClick: () => renameItem(colId, item.id) },
        { label: 'Duplicar', icon: <Copy size={14} />, onClick: () => duplicateItem(colId, item.id) },
        { label: 'Excluir', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteItem(colId, item.id) }
      ]
    : [
        { label: 'Abrir', onClick: () => openItem(colId, item.id) },
        { label: 'Renomear', icon: <Pencil size={14} />, onClick: () => renameItem(colId, item.id) },
        { label: 'Duplicar', icon: <Copy size={14} />, onClick: () => duplicateItem(colId, item.id) },
        { sep: true },
        { label: 'Excluir', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteItem(colId, item.id) }
      ]

  return (
    <>
      <div
        className={`tree-row${active ? ' active' : ''}${drop.zone ? ` drop-${drop.zone}` : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          dragging = { colId, itemId: item.id }
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => (dragging = null)}
        {...drop.handlers}
        onClick={() => (folder ? toggleExpanded(item.id) : openItem(colId, item.id))}
        onDoubleClick={() => folder && openFolderTab(colId, item.id)}
        onContextMenu={(e) => menu.open(e, items)}
      >
        {folder ? (
          <>
            <span className="chev">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
            {expanded ? <FolderOpen size={14} color="var(--fg-muted)" /> : <Folder size={14} color="var(--fg-muted)" />}
          </>
        ) : (
          <ItemBadge item={item} />
        )}
        <span className="name">{item.name}</span>
        <button className={`icon-btn sm more${menu.isOpen ? ' open' : ''}`} onClick={(e) => menu.open(e, items)}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      {menu.node}
      {folder && expanded && item.item!.map((c) => <TreeItem key={c.id} col={col} item={c} depth={depth + 1} q={q} />)}
      {folder && expanded && item.item!.length === 0 && !q && (
        <div className="hint" style={{ paddingLeft: 30 + depth * 14, height: 26, display: 'flex', alignItems: 'center' }}>
          Pasta vazia
        </div>
      )}
    </>
  )
}

function CollectionNode({ col, q }: { col: PMCollection; q: string }) {
  const id = col.info._postman_id
  const expanded = useStore((s) => s.expanded[id]) || !!q
  const active = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.kind === 'collection' && t.collectionId === id
  })
  const menu = useMenu()
  const drop = useDrop(id, null, true)
  if (q && !col.info.name.toLowerCase().includes(q) && !col.item.some((it) => matches(it, q))) return null

  const items: MenuItem[] = [
    { label: 'Nova requisição HTTP', icon: <Plus size={14} />, onClick: () => addRequest(id, null) },
    { label: 'Nova WebSocket', onClick: () => addRequest(id, null, 'websocket') },
    { label: 'Nova Socket.IO', onClick: () => addRequest(id, null, 'socketio') },
    { label: 'Nova MQTT', onClick: () => addRequest(id, null, 'mqtt') },
    { label: 'Nova gRPC', onClick: () => addRequest(id, null, 'grpc') },
    { label: 'Nova pasta', icon: <FolderPlus size={14} />, onClick: () => addFolder(id, null) },
    { sep: true },
    { label: 'Executar coleção', icon: <Play size={14} />, onClick: () => openRunner(id) },
    { label: 'Configurações', icon: <Settings2 size={14} />, onClick: () => openCollectionTab(id) },
    { label: 'Renomear', icon: <Pencil size={14} />, onClick: () => renameCollection(id) },
    { label: 'Duplicar', icon: <Copy size={14} />, onClick: () => duplicateCollection(id) },
    { label: 'Exportar…', icon: <Download size={14} />, onClick: () => exportCollection(id) },
    { sep: true },
    { label: 'Excluir', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteCollection(id) }
  ]

  return (
    <>
      <div
        className={`tree-row${active ? ' active' : ''}${drop.zone ? ' drop-inside' : ''}`}
        style={{ paddingLeft: 8 }}
        {...drop.handlers}
        onClick={() => toggleExpanded(id)}
        onDoubleClick={() => openCollectionTab(id)}
        onContextMenu={(e) => menu.open(e, items)}
      >
        <span className="chev">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="name" style={{ fontWeight: 550 }}>
          {col.info.name}
        </span>
        <button className={`icon-btn sm more${menu.isOpen ? ' open' : ''}`} title="Executar" onClick={(e) => (e.stopPropagation(), openRunner(id))}>
          <Play size={13} />
        </button>
        <button className={`icon-btn sm more${menu.isOpen ? ' open' : ''}`} onClick={(e) => menu.open(e, items)}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      {menu.node}
      {expanded && col.item.map((it) => <TreeItem key={it.id} col={col} item={it} depth={1} q={q} />)}
      {expanded && col.item.length === 0 && !q && (
        <div className="hint" style={{ paddingLeft: 30, height: 28, display: 'flex', alignItems: 'center', gap: 4 }}>
          Vazia.{' '}
          <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => addRequest(id, null)}>
            Adicionar requisição
          </a>
        </div>
      )}
    </>
  )
}

function CollectionsPanel({ q }: { q: string }) {
  const collections = useStore((s) => s.collections)
  if (!collections.length)
    return (
      <div className="empty-hint">
        Nenhuma coleção ainda.
        <br />
        <button className="btn sm" style={{ marginTop: 10 }} onClick={createCollection}>
          Criar coleção
        </button>{' '}
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => openModal('import')}>
          Importar
        </button>
      </div>
    )
  return (
    <>
      {collections.map((c) => (
        <CollectionNode key={c.info._postman_id} col={c} q={q} />
      ))}
    </>
  )
}

function EnvironmentsPanel({ q }: { q: string }) {
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const activeTabEnv = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.envId)
  const globalsActive = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.kind === 'globals')
  const menu = useMenu()
  return (
    <>
      <div className={`tree-row${globalsActive ? ' active' : ''}`} style={{ paddingLeft: 10 }} onClick={openGlobalsTab}>
        <Globe size={14} color="var(--fg-muted)" />
        <span className="name">Globais</span>
      </div>
      <div className="section-label">Ambientes</div>
      {environments
        .filter((e) => e.name.toLowerCase().includes(q))
        .map((e) => {
          const items: MenuItem[] = [
            { label: activeEnvId === e.id ? 'Desativar' : 'Ativar', onClick: () => setActiveEnv(activeEnvId === e.id ? null : e.id) },
            { label: 'Duplicar', icon: <Copy size={14} />, onClick: () => duplicateEnvironment(e.id) },
            { label: 'Exportar…', icon: <Download size={14} />, onClick: () => exportEnvironment(e.id) },
            { sep: true },
            { label: 'Excluir', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteEnvironment(e.id) }
          ]
          return (
            <div
              key={e.id}
              className={`tree-row${activeTabEnv === e.id ? ' active' : ''}`}
              style={{ paddingLeft: 10 }}
              onClick={() => openEnvironmentTab(e.id)}
              onContextMenu={(ev) => menu.open(ev, items)}
            >
              <Layers size={14} color={activeEnvId === e.id ? 'var(--ok)' : 'var(--fg-muted)'} />
              <span className="name">{e.name}</span>
              {activeEnvId === e.id && <span className="pill pass">ATIVO</span>}
              <button className="icon-btn sm more" onClick={(ev) => menu.open(ev, items)}>
                <MoreHorizontal size={14} />
              </button>
            </div>
          )
        })}
      {menu.node}
      {!environments.length && (
        <div className="empty-hint">
          Ambientes guardam variáveis como {'{{baseUrl}}'} e tokens, para trocar entre local, staging e produção.
          <br />
          <button className="btn sm" style={{ marginTop: 10 }} onClick={createEnvironment}>
            Criar ambiente
          </button>
        </div>
      )}
    </>
  )
}

function HistoryPanel({ q }: { q: string }) {
  const history = useStore((s) => s.history)
  const groups = useMemo(() => {
    const out: { day: string; items: typeof history }[] = []
    for (const h of history.filter((h) => h.url.toLowerCase().includes(q))) {
      const day = dayLabel(h.at)
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] })
      out[out.length - 1].items.push(h)
    }
    return out
  }, [history, q])
  if (!history.length) return <div className="empty-hint">As requisições enviadas aparecem aqui.</div>
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 8px' }}>
        <button className="btn ghost sm" onClick={clearHistory}>
          Limpar
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.day}>
          <div className="section-label">{g.day}</div>
          {g.items.map((h) => (
            <div key={h.id} className="tree-row" style={{ paddingLeft: 4 }} onClick={() => openFromHistory(h)} title={h.url}>
              <span className="method-badge" style={{ color: methodColor(h.method) }}>
                {h.method === 'DELETE' ? 'DEL' : h.method}
              </span>
              <span className="name mono" style={{ fontSize: 11.5 }}>
                {h.url.replace(/^https?:\/\//, '')}
              </span>
              <span className="hint" style={{ fontSize: 11 }}>
                {timeAgo(h.at)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

export function Sidebar() {
  const section = useStore((s) => s.sidebarSection)
  const [q, setQ] = useState('')
  const resize = useResizable('sidebar', 290, 200, 560, 'x')
  const ql = q.toLowerCase().trim()

  const sections = [
    { id: 'collections' as const, label: 'Coleções', icon: <Layers size={18} /> },
    { id: 'environments' as const, label: 'Ambientes', icon: <Globe size={18} /> },
    { id: 'history' as const, label: 'Histórico', icon: <Clock size={18} /> }
  ]

  return (
    <>
      <div className="sidebar" style={{ width: resize.size }}>
        <div className="sidebar-rail">
          {sections.map((s) => (
            <button key={s.id} className={`rail-btn${section === s.id ? ' active' : ''}`} onClick={() => useStore.setState({ sidebarSection: s.id })}>
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>
        <div className="sidebar-panel">
          <div className="sidebar-head">
            {section !== 'history' && (
              <button
                className="icon-btn"
                title={section === 'collections' ? 'Nova coleção' : 'Novo ambiente'}
                onClick={section === 'collections' ? createCollection : createEnvironment}
              >
                <Plus size={16} />
              </button>
            )}
            <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--fg-muted)' }} />
              <input className="input sm" style={{ paddingLeft: 26, width: '100%' }} placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {section === 'collections' && (
              <button className="icon-btn" title="Importar" onClick={() => openModal('import')}>
                <Upload size={15} />
              </button>
            )}
          </div>
          <div className="sidebar-body">
            {section === 'collections' && <CollectionsPanel q={ql} />}
            {section === 'environments' && <EnvironmentsPanel q={ql} />}
            {section === 'history' && <HistoryPanel q={ql} />}
          </div>
        </div>
      </div>
      <div className={`resizer${resize.dragging ? ' dragging' : ''}`} onMouseDown={resize.onMouseDown} />
    </>
  )
}
