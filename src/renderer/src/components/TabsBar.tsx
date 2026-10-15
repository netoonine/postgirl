import { FolderOpen, Globe, Layers, Library, Play, Plus, X } from 'lucide-react'
import { closeOtherTabs, closeTab, getCollection, getEnvironment, openNewRequest, setActiveTab, Tab, useStore } from '../store'
import { findItem } from '../util'
import { ItemBadge } from './Sidebar'
import { useMenu } from './ui'

function tabLabel(t: Tab): { title: string; icon: React.ReactNode } {
  const col = getCollection(t.collectionId)
  switch (t.kind) {
    case 'request':
      return { title: t.draft?.name || 'Sem título', icon: t.draft ? <ItemBadge item={t.draft} /> : null }
    case 'collection':
      return { title: col?.info.name || 'Coleção', icon: <Library size={14} color="var(--fg-muted)" /> }
    case 'folder':
      return { title: (col && t.itemId && findItem(col.item, t.itemId)?.item.name) || 'Pasta', icon: <FolderOpen size={14} color="var(--fg-muted)" /> }
    case 'environment':
      return { title: getEnvironment(t.envId)?.name || 'Ambiente', icon: <Layers size={14} color="var(--fg-muted)" /> }
    case 'globals':
      return { title: 'Globais', icon: <Globe size={14} color="var(--fg-muted)" /> }
    case 'runner':
      return { title: `Runner · ${col?.info.name || ''}`, icon: <Play size={14} color="var(--fg-muted)" /> }
  }
}

export function TabsBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  useStore((s) => s.collections) // títulos acompanham renomeações
  useStore((s) => s.environments)
  const menu = useMenu()
  const newMenu = useMenu()

  return (
    <div className="tabsbar">
      <div className="tabs-scroll">
        {tabs.map((t) => {
          const { title, icon } = tabLabel(t)
          return (
            <div
              key={t.id}
              className={`tab${t.id === activeTabId ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
              onContextMenu={(e) =>
                menu.open(e, [
                  { label: 'Fechar', onClick: () => closeTab(t.id) },
                  { label: 'Fechar as outras', onClick: () => closeOtherTabs(t.id) }
                ])
              }
              title={title}
            >
              {icon}
              <span className="title">{title}</span>
              {t.dirty ? (
                <span className="dirty-dot" title="Alterações não salvas" />
              ) : (
                <button className="icon-btn sm x" onClick={(e) => (e.stopPropagation(), closeTab(t.id))}>
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        className="icon-btn"
        style={{ margin: 'auto 6px' }}
        title="Nova aba (⌘T)"
        onClick={(e) =>
          newMenu.open(e, [
            { label: 'HTTP', onClick: () => openNewRequest('http') },
            {
              label: 'GraphQL',
              onClick: () =>
                openNewRequest('http', {
                  request: { method: 'POST', header: [], url: { raw: '' }, body: { mode: 'graphql', graphql: { query: '', variables: '' } } }
                })
            },
            { label: 'WebSocket', onClick: () => openNewRequest('websocket') },
            { label: 'Socket.IO', onClick: () => openNewRequest('socketio') },
            { label: 'MQTT', onClick: () => openNewRequest('mqtt') },
            { label: 'gRPC', onClick: () => openNewRequest('grpc') }
          ])
        }
      >
        <Plus size={16} />
      </button>
      {menu.node}
      {newMenu.node}
    </div>
  )
}
