import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
import { clearLogs, LogEntry, toggleConsole, useStore } from '../store'
import { formatMs, methodColor, statusColor } from '../util'
import { useResizable } from './ui'

function RequestLog({ l }: { l: LogEntry }) {
  const [open, setOpen] = useState(false)
  const r = l.result
  return (
    <div className="log-row" style={{ flexDirection: 'column', gap: 4, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="ts">{new Date(l.at).toLocaleTimeString('pt-BR')}</span>
        <b style={{ color: methodColor(l.method) }}>{l.method}</b>
        <span style={{ flex: 1 }}>{l.url}</span>
        {l.error ? <span style={{ color: 'var(--err)' }}>{l.error}</span> : <span style={{ color: statusColor(l.code) }}>{l.code}</span>}
        {l.time !== undefined && <span className="ts">{formatMs(l.time)}</span>}
      </div>
      {open && r && (
        <div style={{ paddingLeft: 22, cursor: 'text' }} onClick={(e) => e.stopPropagation()}>
          {r.sent && (
            <>
              <div style={{ color: 'var(--fg-muted)', marginTop: 4 }}>Headers enviados</div>
              {r.sent.headers.map((h, i) => (
                <div key={i}>
                  {h.key}: {h.value}
                </div>
              ))}
              {r.sent.body && (
                <>
                  <div style={{ color: 'var(--fg-muted)', marginTop: 4 }}>Corpo enviado</div>
                  <div>{r.sent.body.slice(0, 4000)}</div>
                </>
              )}
            </>
          )}
          {r.response && (
            <>
              <div style={{ color: 'var(--fg-muted)', marginTop: 4 }}>Headers recebidos</div>
              {r.response.headers.map((h, i) => (
                <div key={i}>
                  {h.key}: {h.value}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function ConsolePanel() {
  const logs = useStore((s) => s.logs)
  const resize = useResizable('console', 220, 80, 700, 'y', true)
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [logs.length])
  return (
    <>
      <div className={`resizer-h${resize.dragging ? ' dragging' : ''}`} onMouseDown={resize.onMouseDown} />
      <div className="console" style={{ height: resize.size }}>
        <div className="console-head">
          Console
          <span className="hint" style={{ fontWeight: 400 }}>
            requisições e console.log dos scripts
          </span>
          <div className="spacer" />
          <button className="icon-btn sm" title="Limpar" onClick={clearLogs}>
            <Trash2 size={13} />
          </button>
          <button className="icon-btn sm" title="Fechar" onClick={toggleConsole}>
            <X size={13} />
          </button>
        </div>
        <div className="console-body">
          {logs.length === 0 && <div className="empty-hint">Nada por aqui ainda.</div>}
          {logs.map((l) =>
            l.kind === 'request' ? (
              <RequestLog key={l.id} l={l} />
            ) : (
              <div key={l.id} className={`log-row ${l.level}`}>
                <span className="ts">{new Date(l.at).toLocaleTimeString('pt-BR')}</span>
                <span>{l.messages?.join(' ')}</span>
              </div>
            )
          )}
          <div ref={bottom} />
        </div>
      </div>
    </>
  )
}
