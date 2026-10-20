import { useEffect, useState } from 'react'
import { Cookie, Eye, Globe2, Layers, PanelLeft, Plus, Radio, Search, Settings, Terminal, Upload, Zap } from 'lucide-react'
import { api } from '../api'
import {
  chooseWorkspace,
  closeTab,
  createCollection,
  getEnvironment,
  init,
  openEnvironmentTab,
  openGlobalsTab,
  openModal,
  openNewRequest,
  reloadWorkspace,
  saveTab,
  sendTab,
  setActiveEnv,
  toggleConsole,
  toggleSidebar,
  applyTheme,
  handleMockEvent,
  setPalette,
  syncFromDisk,
  useStore
} from '../store'
import { CollectionView } from './CollectionView'
import { ConsolePanel } from './ConsolePanel'
import { EnvironmentView, GlobalsView } from './EnvironmentView'
import { Modals } from './Modals'
import { Palette } from './Palette'
import { handleRtEvent, RealtimeView } from './RealtimeView'
import { RequestView } from './RequestView'
import { RunnerView } from './RunnerView'
import { Sidebar } from './Sidebar'
import { TabsBar } from './TabsBar'
import { useMenu } from './ui'
import logo64 from '../assets/logo-64.png'
import logo256 from '../assets/logo-256.png'

const isMac = navigator.platform.toLowerCase().includes('mac')

function Toasts() {
  const [list, setList] = useState<{ id: number; message: string; kind: string }[]>([])
  useEffect(() => {
    const on = (e: Event) => {
      const { message, kind } = (e as CustomEvent).detail
      const id = Date.now() + Math.random()
      setList((l) => [...l, { id, message, kind }])
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 2600)
    }
    window.addEventListener('postwoman-toast', on)
    return () => window.removeEventListener('postwoman-toast', on)
  }, [])
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}

function EnvSelector() {
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const globals = useStore((s) => s.globals)
  const [peek, setPeek] = useState(false)
  const env = getEnvironment(activeEnvId)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
      <Layers size={14} color={env ? 'var(--ok)' : 'var(--fg-muted)'} />
      <select className="select sm" style={{ width: 190 }} value={activeEnvId || ''} onChange={(e) => setActiveEnv(e.target.value || null)}>
        <option value="">Sem ambiente</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <button className="icon-btn" title="Ver variáveis" onClick={() => setPeek(!peek)}>
        <Eye size={15} />
      </button>
      {peek && (
        <div className="menu" style={{ top: 34, right: 0, width: 380, padding: 12, position: 'absolute' }} onMouseLeave={() => setPeek(false)}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <b>{env?.name || 'Sem ambiente'}</b>
            <div className="spacer" />
            {env && (
              <button className="btn ghost sm" onClick={() => (setPeek(false), openEnvironmentTab(env.id))}>
                Editar
              </button>
            )}
          </div>
          <table className="hdr-table">
            <tbody>
              {(env?.values || [])
                .filter((v) => v.enabled !== false)
                .map((v) => (
                  <tr key={v.key}>
                    <td>{v.key}</td>
                    <td className="mono">{v.type === 'secret' ? '••••••' : v.value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', margin: '12px 0 6px' }}>
            <b>Globais</b>
            <div className="spacer" />
            <button className="btn ghost sm" onClick={() => (setPeek(false), openGlobalsTab())}>
              Editar
            </button>
          </div>
          <table className="hdr-table">
            <tbody>
              {globals
                .filter((v) => v.enabled !== false)
                .map((v) => (
                  <tr key={v.key}>
                    <td>{v.key}</td>
                    <td className="mono">{v.type === 'secret' ? '••••••' : v.value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Welcome() {
  const cards = [
    { label: 'HTTP', icon: <Globe2 size={20} />, onClick: () => openNewRequest('http') },
    { label: 'WebSocket', icon: <Zap size={20} />, onClick: () => openNewRequest('websocket') },
    { label: 'gRPC', icon: <Radio size={20} />, onClick: () => openNewRequest('grpc') },
    { label: 'Socket.IO', icon: <Zap size={20} />, onClick: () => openNewRequest('socketio') },
    { label: 'MQTT', icon: <Radio size={20} />, onClick: () => openNewRequest('mqtt') },
    { label: 'Importar', icon: <Upload size={20} />, onClick: () => openModal('import') }
  ]
  return (
    <div className="welcome">
      <img src={logo256} width={88} height={88} alt="Postwoman" />
      <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--fg)' }}>Nova requisição</div>
      <div className="welcome-grid">
        {cards.map((c) => (
          <div key={c.label} className="welcome-card" onClick={c.onClick}>
            {c.icon}
            {c.label}
          </div>
        ))}
      </div>
      <div className="hint" style={{ textAlign: 'center', lineHeight: 2 }}>
        <span className="kbd">⌘T</span> nova aba · <span className="kbd">⌘Enter</span> enviar · <span className="kbd">⌘S</span> salvar ·{' '}
        <span className="kbd">⌘O</span> importar · <span className="kbd">⌘K</span> buscar · <span className="kbd">⌥⌘C</span> console
      </div>
    </div>
  )
}

function Workarea() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  let content: React.ReactNode = <Welcome />
  if (tab?.kind === 'request') content = tab.draft?.postwoman ? <RealtimeView key={tab.id} tab={tab} /> : <RequestView key={tab.id} tab={tab} />
  if (tab?.kind === 'collection' || tab?.kind === 'folder') content = <CollectionView key={tab.id} tab={tab} />
  if (tab?.kind === 'environment') content = <EnvironmentView key={tab.id} tab={tab} />
  if (tab?.kind === 'globals') content = <GlobalsView />
  if (tab?.kind === 'runner') content = <RunnerView key={tab.id} tab={tab} />
  return (
    <div className="workarea">
      <TabsBar />
      {content}
    </div>
  )
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const workspacePath = useStore((s) => s.workspacePath)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const consoleOpen = useStore((s) => s.consoleOpen)
  const logCount = useStore((s) => s.logs.length)
  const newMenu = useMenu()

  useEffect(() => {
    init()
    const offRt = api.rt.onEvent(handleRtEvent)
    const offMock = api.mock.onEvent(handleMockEvent)
    const offDisk = api.onWorkspaceChanged((files) => syncFromDisk(files))
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', applyTheme)
    const active = () => useStore.getState().activeTabId
    const offMenu = api.onMenu((id) => {
      const t = active()
      if (id === 'new-request') openNewRequest('http')
      if (id === 'new-collection') createCollection()
      if (id === 'import') openModal('import')
      if (id === 'save' && t) saveTab(t)
      if (id === 'close-tab' && t) closeTab(t)
      if (id === 'toggle-console') toggleConsole()
      if (id === 'toggle-sidebar') toggleSidebar()
      if (id === 'settings') openModal('settings')
      if (id === 'choose-workspace') chooseWorkspace()
      if (id === 'reload-workspace') reloadWorkspace()
      if (id === 'palette') setPalette(true)
    })
    const keys = (e: KeyboardEvent) => {
      // fallback do atalho do menu (⌘K / Ctrl+K e ⌘P), útil também em testes automatizados
      if ((e.metaKey || e.ctrlKey) && ['k', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        setPalette(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const t = useStore.getState().tabs.find((x) => x.id === active())
        if (t?.kind === 'request' && !t.draft?.postwoman) {
          e.preventDefault()
          sendTab(t.id)
        }
      }
    }
    document.addEventListener('keydown', keys)
    return () => {
      offRt()
      offMock()
      offDisk()
      offMenu()
      mq.removeEventListener('change', applyTheme)
      document.removeEventListener('keydown', keys)
    }
  }, [])

  if (!ready) return null

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">
          <img src={logo64} width={20} height={20} alt="" /> Postwoman
        </span>
        <button
          className="btn sm"
          onClick={(e) =>
            newMenu.open(e, [
              { label: 'Requisição HTTP', onClick: () => openNewRequest('http') },
              { label: 'Coleção', onClick: createCollection },
              { sep: true },
              { label: 'WebSocket', onClick: () => openNewRequest('websocket') },
              { label: 'Socket.IO', onClick: () => openNewRequest('socketio') },
              { label: 'MQTT', onClick: () => openNewRequest('mqtt') },
              { label: 'gRPC', onClick: () => openNewRequest('grpc') }
            ])
          }
        >
          <Plus size={14} /> Novo
        </button>
        <button className="btn sm" onClick={() => openModal('import')}>
          <Upload size={14} /> Importar
        </button>
        <span className="ws-path" title={workspacePath}>
          {workspacePath}
        </span>
        <div className="spacer" />
        <button className="btn sm search-btn" title="Buscar (⌘K)" onClick={() => setPalette(true)}>
          <Search size={13} /> Buscar <span className="kbd">{isMac ? '⌘K' : 'Ctrl+K'}</span>
        </button>
        <EnvSelector />
        <button className="icon-btn" title="Cookies" onClick={() => openModal('cookies')}>
          <Cookie size={15} />
        </button>
        <button className="icon-btn" title="Configurações (⌘,)" onClick={() => openModal('settings')}>
          <Settings size={15} />
        </button>
        {newMenu.node}
      </div>
      <div className="main">
        {sidebarOpen && <Sidebar />}
        <Workarea />
      </div>
      <div>
        {consoleOpen && <ConsolePanel />}
        <div className="statusbar">
          <button onClick={toggleSidebar} title="Barra lateral (⌘\)">
            <PanelLeft size={13} />
          </button>
          <button onClick={toggleConsole}>
            <Terminal size={13} /> Console {logCount > 0 && `(${logCount})`}
          </button>
          <div className="spacer" />
          <button onClick={() => openModal('cookies')}>
            <Cookie size={13} /> Cookies
          </button>
        </div>
      </div>
      <Modals />
      <Palette />
      <Toasts />
    </div>
  )
}
