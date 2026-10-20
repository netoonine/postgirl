import { useState } from 'react'
import { create } from 'zustand'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, FileUp, Save, Search, Trash2 } from 'lucide-react'
import type { KV, RealtimeEvent } from '@shared/types'
import { api, GrpcMethodInfo } from '../api'
import { saveTab, Tab, toast, updateDraft } from '../store'
import { resolveVars, ResolvedVar } from '../util'
import { CodeEditor } from './CodeEditor'
import { KVTable } from './KVTable'
import { useLocation, useVars } from './RequestView'
import { SubTabs } from './ui'
import { VarInput, VarsContext } from './VarInput'

interface Msg {
  direction: 'in' | 'out'
  data: string
  at: number
  event?: string
  topic?: string
  binary?: boolean
}

interface ConnState {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  detail?: string
  messages: Msg[]
  methods?: GrpcMethodInfo[]
}

// estado das conexões fica fora do componente: trocar de aba não derruba a conexão
export const useRt = create<Record<string, ConnState>>(() => ({}))
const EMPTY: ConnState = { status: 'idle', messages: [] }
const patch = (id: string, p: Partial<ConnState>) => useRt.setState((s) => ({ [id]: { ...EMPTY, ...s[id], ...p } }))

export function handleRtEvent(e: RealtimeEvent) {
  const cur = useRt.getState()[e.connId] || { status: 'idle', messages: [] }
  if (e.type === 'status') patch(e.connId, { status: e.status, detail: e.detail })
  if (e.type === 'message')
    patch(e.connId, {
      messages: [...cur.messages, { direction: e.direction, data: e.data, at: e.at, event: e.event, topic: e.topic, binary: e.binary }].slice(-2000)
    })
  if (e.type === 'grpc-end')
    patch(e.connId, {
      status: 'disconnected',
      detail: `${e.status} · ${e.time} ms`,
      messages:
        e.trailers && Object.keys(e.trailers).length
          ? [...cur.messages, { direction: 'in', event: 'trailers', data: JSON.stringify(e.trailers, null, 2), at: Date.now() }]
          : cur.messages
    })
}

const LABEL: Record<string, string> = { websocket: 'WebSocket', socketio: 'Socket.IO', mqtt: 'MQTT', grpc: 'gRPC' }
const STATUS_LABEL: Record<string, string> = {
  idle: 'Desconectado',
  connecting: 'Conectando…',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Erro'
}

const kvToObj = (rows: KV[] = [], vars: Map<string, ResolvedVar>) =>
  Object.fromEntries(rows.filter((r) => r.key && !r.disabled).map((r) => [resolveVars(r.key, vars), resolveVars(r.value, vars)]))

export function RealtimeView({ tab }: { tab: Tab }) {
  const draft = tab.draft!
  const protocol = draft.postgirl!.protocol
  const cfg = draft.postgirl!.config
  const conn = useRt((s) => s[tab.id]) || { status: 'idle', messages: [] }
  const vars = useVars(tab.collectionId)
  const { col } = useLocation(tab)
  const [sub, setSub] = useState('message')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [loadingMethods, setLoadingMethods] = useState(false)

  const set = (p: Record<string, any>) => updateDraft(tab.id, (d) => Object.assign(d.postgirl!.config, p))
  const r = (s: string) => resolveVars(s || '', vars)
  const live = conn.status === 'connected' || conn.status === 'connecting'

  const connect = async () => {
    patch(tab.id, { messages: conn.messages, detail: undefined })
    try {
      if (protocol === 'websocket')
        await api.rt.ws({
          connId: tab.id,
          url: r(cfg.url),
          headers: kvToObj(cfg.headers, vars),
          protocols: r(cfg.protocols)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        })
      if (protocol === 'socketio')
        await api.rt.io({
          connId: tab.id,
          url: r(cfg.url),
          path: r(cfg.path),
          headers: kvToObj(cfg.headers, vars),
          auth: r(cfg.auth),
          events: cfg.events || []
        })
      if (protocol === 'mqtt')
        await api.rt.mqtt({
          connId: tab.id,
          url: r(cfg.url),
          clientId: r(cfg.clientId),
          username: r(cfg.username),
          password: r(cfg.password),
          version: cfg.version,
          subscriptions: (cfg.subscriptions || []).filter((s: any) => !s.disabled).map((s: any) => ({ topic: r(s.topic), qos: Number(s.qos) || 0 }))
        })
    } catch (e: any) {
      patch(tab.id, { status: 'error', detail: e.message })
    }
  }

  const sendMsg = () => {
    const data = r(cfg.message)
    if (protocol === 'websocket') api.rt.send(tab.id, data)
    if (protocol === 'socketio') api.rt.send(tab.id, data, { event: r(cfg.event) || 'message', json: cfg.json !== false, ack: !!cfg.ack })
    if (protocol === 'mqtt') {
      if (!cfg.topic) return toast('Informe o tópico', 'error')
      api.rt.send(tab.id, data, { topic: r(cfg.topic), qos: Number(cfg.qos) || 0, retain: !!cfg.retain })
    }
    if (protocol === 'grpc') api.rt.send(tab.id, data)
  }

  const loadMethods = async () => {
    setLoadingMethods(true)
    try {
      const methods = await api.rt.grpcLoad({ url: r(cfg.url), tls: !!cfg.tls, protoPath: cfg.source === 'proto' ? cfg.protoPath : undefined })
      patch(tab.id, { methods })
      if (!methods.length) toast('Nenhum serviço encontrado', 'error')
      else if (!methods.some((m) => m.path === cfg.method)) set({ method: methods[0].path, message: methods[0].sample })
    } catch (e: any) {
      toast(`gRPC: ${e.details || e.message}`, 'error')
    } finally {
      setLoadingMethods(false)
    }
  }

  const invoke = async () => {
    if (!conn.methods) await loadMethods()
    patch(tab.id, { status: 'connecting', detail: undefined })
    try {
      await api.rt.grpcInvoke({
        connId: tab.id,
        url: r(cfg.url),
        protoPath: cfg.source === 'proto' ? cfg.protoPath : undefined,
        path: cfg.method,
        message: r(cfg.message),
        metadata: kvToObj(cfg.metadata, vars),
        tls: !!cfg.tls,
        deadlineMs: Number(cfg.deadlineMs) || undefined
      })
    } catch (e: any) {
      patch(tab.id, { status: 'error', detail: e.message })
    }
  }

  const method = conn.methods?.find((m) => m.path === cfg.method)
  const grpcStreaming = protocol === 'grpc' && method?.requestStream

  const tabs =
    protocol === 'websocket'
      ? [
          { id: 'message', label: 'Mensagem' },
          { id: 'headers', label: 'Headers' },
          { id: 'settings', label: 'Opções' }
        ]
      : protocol === 'socketio'
        ? [
            { id: 'message', label: 'Mensagem' },
            { id: 'headers', label: 'Headers' },
            { id: 'settings', label: 'Opções' }
          ]
        : protocol === 'mqtt'
          ? [
              { id: 'message', label: 'Publicar' },
              { id: 'subs', label: 'Assinaturas' },
              { id: 'settings', label: 'Conexão' }
            ]
          : [
              { id: 'message', label: 'Mensagem' },
              { id: 'metadata', label: 'Metadata' },
              { id: 'settings', label: 'Opções' }
            ]

  const shown = conn.messages.filter((m) => !q || m.data.toLowerCase().includes(q.toLowerCase()) || m.event?.includes(q) || m.topic?.includes(q))

  return (
    <VarsContext.Provider value={vars}>
      <div className="request-view">
        <div className="req-header">
          <div className="breadcrumb">
            {col && (
              <>
                <span>{col.info.name}</span>
                <ChevronRight size={12} />
              </>
            )}
            <input
              className="inline-edit"
              style={{ fontSize: 13, fontWeight: 600, padding: '2px 4px' }}
              value={draft.name}
              onChange={(e) => updateDraft(tab.id, (d) => (d.name = e.target.value))}
            />
          </div>
          <div className="spacer" />
          <button className="btn sm" onClick={() => saveTab(tab.id)}>
            <Save size={14} /> Salvar
          </button>
        </div>
        <div className="urlbar">
          <div className="urlbar-field">
            <span className="method-select" style={{ display: 'flex', alignItems: 'center', color: 'var(--m-head)' }}>
              {LABEL[protocol]}
            </span>
            <VarInput
              value={cfg.url}
              placeholder={protocol === 'grpc' ? 'host:porta' : protocol === 'mqtt' ? 'mqtt://host:1883' : 'wss://host/caminho'}
              onChange={(url) => updateDraft(tab.id, (d) => ((d.postgirl!.config.url = url), (d.request!.url = { raw: url })))}
              onEnter={() => (protocol === 'grpc' ? invoke() : !live && connect())}
            />
          </div>
          {protocol === 'grpc' ? (
            <>
              <label className="check" title="Usar TLS (grpcs)">
                <input type="checkbox" checked={!!cfg.tls} onChange={(e) => set({ tls: e.target.checked })} /> TLS
              </label>
              {live ? (
                <button className="btn" onClick={() => api.rt.disconnect(tab.id)}>
                  Cancelar
                </button>
              ) : (
                <button className="btn primary" style={{ width: 96 }} disabled={!cfg.method && !!conn.methods} onClick={invoke}>
                  Invocar
                </button>
              )}
            </>
          ) : live ? (
            <button className="btn" style={{ width: 110 }} onClick={() => api.rt.disconnect(tab.id)}>
              Desconectar
            </button>
          ) : (
            <button className="btn primary" style={{ width: 110 }} onClick={connect}>
              Conectar
            </button>
          )}
        </div>

        <div className="rt-layout">
          <div className="rt-compose">
            <SubTabs value={sub} onChange={setSub} tabs={tabs} />
            <div className="pane-body" style={sub === 'message' ? { display: 'flex', flexDirection: 'column', gap: 8 } : undefined}>
              {sub === 'message' && protocol === 'grpc' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="select grpc-method"
                    style={{ flex: 1 }}
                    value={cfg.method}
                    onChange={(e) => {
                      const m = conn.methods?.find((x) => x.path === e.target.value)
                      set({ method: e.target.value, ...(m ? { message: m.sample } : {}) })
                    }}
                  >
                    {!conn.methods && <option value={cfg.method}>{cfg.method || 'Carregue os métodos →'}</option>}
                    {conn.methods?.map((m) => (
                      <option key={m.path} value={m.path}>
                        {m.service.split('.').pop()}/{m.method}
                        {m.requestStream || m.responseStream
                          ? `  (${m.requestStream ? 'client' : ''}${m.requestStream && m.responseStream ? '+' : ''}${m.responseStream ? 'server' : ''} stream)`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <button className="btn" disabled={loadingMethods} onClick={loadMethods}>
                    {loadingMethods ? 'Carregando…' : 'Carregar métodos'}
                  </button>
                </div>
              )}
              {sub === 'message' && protocol === 'socketio' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="urlbar-field" style={{ flex: 1, borderRadius: 7 }}>
                    <VarInput cell value={cfg.event || ''} placeholder="Nome do evento" onChange={(event) => set({ event })} />
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={cfg.json !== false} onChange={(e) => set({ json: e.target.checked })} /> JSON
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={!!cfg.ack} onChange={(e) => set({ ack: e.target.checked })} /> Ack
                  </label>
                </div>
              )}
              {sub === 'message' && protocol === 'mqtt' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="urlbar-field" style={{ flex: 1, borderRadius: 7 }}>
                    <VarInput cell value={cfg.topic || ''} placeholder="Tópico" onChange={(topic) => set({ topic })} />
                  </div>
                  <select className="select sm" value={cfg.qos ?? 0} onChange={(e) => set({ qos: +e.target.value })}>
                    <option value={0}>QoS 0</option>
                    <option value={1}>QoS 1</option>
                    <option value={2}>QoS 2</option>
                  </select>
                  <label className="check">
                    <input type="checkbox" checked={!!cfg.retain} onChange={(e) => set({ retain: e.target.checked })} /> Retain
                  </label>
                </div>
              )}
              {sub === 'message' && (
                <>
                  <div className="editor-box">
                    <CodeEditor value={cfg.message || ''} lang="json" placeholder="Mensagem (texto ou JSON)" onChange={(message) => set({ message })} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {protocol === 'grpc' ? (
                      grpcStreaming &&
                      live && (
                        <>
                          <button className="btn" onClick={() => api.rt.end(tab.id)}>
                            Encerrar stream
                          </button>
                          <button className="btn primary" onClick={sendMsg}>
                            Enviar no stream
                          </button>
                        </>
                      )
                    ) : (
                      <button className="btn primary" disabled={conn.status !== 'connected'} onClick={sendMsg}>
                        {protocol === 'mqtt' ? 'Publicar' : 'Enviar'}
                      </button>
                    )}
                  </div>
                </>
              )}
              {sub === 'headers' && <KVTable title="Headers do handshake" rows={cfg.headers || []} onChange={(headers) => set({ headers })} />}
              {sub === 'metadata' && <KVTable title="Metadata" rows={cfg.metadata || []} onChange={(metadata) => set({ metadata })} />}
              {sub === 'subs' && (
                <>
                  <KVTable
                    title="Tópicos assinados ao conectar"
                    keyPlaceholder="Tópico"
                    valuePlaceholder="QoS (0, 1 ou 2)"
                    description={false}
                    rows={(cfg.subscriptions || []).map((s: any) => ({ key: s.topic, value: String(s.qos ?? 0), disabled: s.disabled }))}
                    onChange={(rows) => set({ subscriptions: rows.map((x) => ({ topic: x.key, qos: Number(x.value) || 0, disabled: x.disabled })) })}
                  />
                  <p className="hint">Curingas: + (um nível) e # (vários níveis). Mudanças valem na próxima conexão.</p>
                </>
              )}
              {sub === 'settings' && (
                <div className="form-grid">
                  {protocol === 'websocket' && (
                    <>
                      <label>Subprotocolos</label>
                      <input
                        className="input"
                        placeholder="graphql-ws, chat (separados por vírgula)"
                        value={cfg.protocols || ''}
                        onChange={(e) => set({ protocols: e.target.value })}
                      />
                    </>
                  )}
                  {protocol === 'socketio' && (
                    <>
                      <label>Caminho</label>
                      <input className="input" value={cfg.path || ''} placeholder="/socket.io" onChange={(e) => set({ path: e.target.value })} />
                      <label>Auth (JSON)</label>
                      <textarea
                        className="textarea mono"
                        rows={4}
                        value={cfg.auth || ''}
                        placeholder='{"token": "{{token}}"}'
                        onChange={(e) => set({ auth: e.target.value })}
                      />
                    </>
                  )}
                  {protocol === 'mqtt' && (
                    <>
                      <label>Client ID</label>
                      <input
                        className="input"
                        value={cfg.clientId || ''}
                        placeholder="Gerado automaticamente"
                        onChange={(e) => set({ clientId: e.target.value })}
                      />
                      <label>Usuário</label>
                      <input className="input" value={cfg.username || ''} onChange={(e) => set({ username: e.target.value })} />
                      <label>Senha</label>
                      <input className="input" type="password" value={cfg.password || ''} onChange={(e) => set({ password: e.target.value })} />
                      <label>Versão do protocolo</label>
                      <select className="select" value={cfg.version || 4} onChange={(e) => set({ version: +e.target.value })}>
                        <option value={4}>MQTT 3.1.1</option>
                        <option value={5}>MQTT 5</option>
                      </select>
                    </>
                  )}
                  {protocol === 'grpc' && (
                    <>
                      <label>Definição do serviço</label>
                      <select className="select" value={cfg.source || 'reflection'} onChange={(e) => set({ source: e.target.value })}>
                        <option value="reflection">Server reflection</option>
                        <option value="proto">Arquivo .proto</option>
                      </select>
                      {cfg.source === 'proto' && (
                        <>
                          <label>Arquivo .proto</label>
                          <div className="file-pick" style={{ padding: 0 }}>
                            <button
                              className="btn sm"
                              onClick={async () => {
                                const p = await api.openFile({ title: 'Arquivo .proto', extensions: ['proto'] })
                                if (p) set({ protoPath: p })
                              }}
                            >
                              <FileUp size={13} /> Escolher
                            </button>
                            <span>{cfg.protoPath || 'Nenhum'}</span>
                          </div>
                        </>
                      )}
                      <label>Deadline (ms)</label>
                      <input className="input" type="number" min={0} value={cfg.deadlineMs || 0} onChange={(e) => set({ deadlineMs: +e.target.value })} />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rt-messages">
            <div className="subtabs" style={{ gap: 10 }}>
              <span className={`status-dot ${conn.status}`} />
              <b style={{ fontWeight: 600 }}>{STATUS_LABEL[conn.status]}</b>
              {conn.detail && (
                <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conn.detail}
                </span>
              )}
              <div className="spacer" />
              <div style={{ position: 'relative', display: 'flex' }}>
                <Search size={12} style={{ position: 'absolute', left: 7, top: 7, color: 'var(--fg-muted)' }} />
                <input className="input sm" style={{ paddingLeft: 22, width: 160 }} placeholder="Filtrar" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <button className="icon-btn" title="Limpar mensagens" onClick={() => patch(tab.id, { messages: [] })}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className="rt-list">
              {shown.length === 0 && (
                <div className="empty-hint">{protocol === 'grpc' ? 'Invoque um método para ver a resposta.' : 'Conecte para trocar mensagens.'}</div>
              )}
              {shown.map((m, i) => (
                <div key={i} className={`rt-msg${expanded[i] ? ' expanded' : ''}`} onClick={() => setExpanded({ ...expanded, [i]: !expanded[i] })}>
                  <span className={`dir ${m.direction}`}>{m.direction === 'in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                  {(m.event || m.topic) && <span className="tag">{m.event || m.topic}</span>}
                  {m.binary && <span className="tag">binário (base64)</span>}
                  <pre>{m.data}</pre>
                  <span className="hint" style={{ fontSize: 11, flexShrink: 0 }}>
                    {new Date(m.at).toLocaleTimeString('pt-BR')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </VarsContext.Provider>
  )
}
