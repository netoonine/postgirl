import { useState } from 'react'
import { Copy, Play, Server, Square } from 'lucide-react'
import type { PMAuth, PMEvent, KV } from '@shared/types'
import { getCollection, openRunner, startMock, stopMock, Tab, toast, updateCollection, useStore } from '../store'
import { effectiveAuth, findItem, methodColor, statusColor, timeAgo, walk } from '../util'
import { AuthEditor } from './AuthEditor'
import { KVTable } from './KVTable'
import { useVars } from './RequestView'
import { ScriptsEditor } from './ScriptsEditor'
import { SubTabs } from './ui'
import { VarsContext } from './VarInput'

type Sub = 'overview' | 'auth' | 'scripts' | 'variables' | 'mock'

/** Configurações de coleção ou pasta: descrição, auth, scripts e variáveis. Salva sozinho. */
export function CollectionView({ tab }: { tab: Tab }) {
  const [sub, setSub] = useState<Sub>('overview')
  useStore((s) => s.collections)
  const mocks = useStore((s) => s.mocks)
  const vars = useVars(tab.collectionId)
  const col = getCollection(tab.collectionId)
  if (!col) return <div className="empty-hint">Coleção não encontrada.</div>
  const colId = col.info._postman_id
  const isFolder = tab.kind === 'folder'
  const found = isFolder ? findItem(col.item, tab.itemId!) : null
  if (isFolder && !found) return <div className="empty-hint">Pasta não encontrada.</div>

  const name = isFolder ? found!.item.name : col.info.name
  const description = (isFolder ? found!.item.description : col.info.description) || ''
  const auth = isFolder ? found!.item.auth : col.auth
  const events = isFolder ? found!.item.event : col.event
  const inherited = isFolder ? effectiveAuth(col, found!.ancestors, null) : { auth: null, from: '' }

  const edit = (fn: (target: { name: string; description?: string; auth?: PMAuth | null; event?: PMEvent[]; variable?: KV[] }) => void) =>
    updateCollection(colId, (c) => {
      if (isFolder) fn(findItem(c.item, tab.itemId!)!.item)
      else {
        const proxy = { name: c.info.name, description: c.info.description, auth: c.auth, event: c.event, variable: c.variable }
        fn(proxy)
        c.info.name = proxy.name
        c.info.description = proxy.description
        c.auth = proxy.auth
        c.event = proxy.event
        c.variable = proxy.variable
      }
    })

  const count = (list?: any[]) => list?.length || 0
  const mockRunning = !!mocks[colId]?.running
  let requests = 0
  const countReqs = (items: any[]) => items.forEach((i) => (i.item ? countReqs(i.item) : requests++))
  countReqs(isFolder ? found!.item.item || [] : col.item)

  return (
    <VarsContext.Provider value={vars}>
      <div className="request-view">
        <div className="page-head">
          <input className="inline-edit" value={name} onChange={(e) => edit((t) => (t.name = e.target.value))} />
          <button className="btn primary sm" onClick={() => openRunner(colId, isFolder ? tab.itemId : undefined)}>
            <Play size={13} /> Executar
          </button>
        </div>
        <SubTabs
          value={sub}
          onChange={setSub}
          tabs={[
            { id: 'overview', label: 'Visão geral' },
            { id: 'auth', label: 'Autorização' },
            { id: 'scripts', label: 'Scripts' },
            ...(!isFolder
              ? [{ id: 'variables' as const, label: <>Variáveis {count(col.variable) > 0 && <span className="count">{count(col.variable)}</span>}</> }]
              : []),
            ...(!isFolder ? [{ id: 'mock' as const, label: <>Mock server {mockRunning && <span className="count ok-dot">●</span>}</> }] : [])
          ]}
        />
        <div className="pane-body" style={sub === 'scripts' ? { display: 'flex', flexDirection: 'column' } : undefined}>
          {sub === 'overview' && (
            <div style={{ maxWidth: 760 }}>
              <p className="hint">
                {requests} requisiç{requests === 1 ? 'ão' : 'ões'}
                {isFolder ? '' : ` · salva em ${useStore.getState().workspacePath}/collections`}
              </p>
              <textarea
                className="textarea"
                style={{ width: '100%', minHeight: 260 }}
                placeholder={`Descreva ${isFolder ? 'esta pasta' : 'esta coleção'} (Markdown)`}
                value={description}
                onChange={(e) => edit((t) => (t.description = e.target.value))}
              />
            </div>
          )}
          {sub === 'auth' && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Requisições com “Herdar do pai” usam esta autenticação.
              </p>
              <AuthEditor
                auth={auth}
                canInherit={isFolder}
                inheritedFrom={{ type: inherited.auth?.type, from: inherited.from }}
                onChange={(a) => edit((t) => (t.auth = a || undefined))}
              />
            </>
          )}
          {sub === 'scripts' && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Estes scripts rodam antes/depois de toda requisição {isFolder ? 'desta pasta' : 'da coleção'}.
              </p>
              <ScriptsEditor events={events} onChange={(ev) => edit((t) => (t.event = ev))} />
            </>
          )}
          {sub === 'variables' && (
            <>
              <KVTable title="Variáveis da coleção" keyPlaceholder="Variável" rows={col.variable || []} onChange={(rows) => edit((t) => (t.variable = rows))} />
              <p className="hint">Valem para todas as requisições da coleção. O ambiente ativo tem prioridade sobre elas.</p>
            </>
          )}
          {sub === 'mock' && <MockPanel collectionId={colId} />}
        </div>
      </div>
    </VarsContext.Provider>
  )
}

function MockPanel({ collectionId }: { collectionId: string }) {
  const mock = useStore((s) => s.mocks[collectionId])
  const col = useStore((s) => s.collections.find((c) => c.info._postman_id === collectionId))
  const [port, setPort] = useState(mock?.port || 4010)
  if (!col) return null
  let examples = 0
  walk(col.item, (it) => !it.item && (examples += it.response?.length || 0))
  const url = mock?.port ? `http://localhost:${mock.port}` : ''
  return (
    <div style={{ maxWidth: 860 }}>
      <p className="hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
        Sobe um servidor HTTP local que responde com os <b>exemplos salvos</b> das requisições desta coleção (botão “Salvar como exemplo” na resposta). O
        caminho da URL é comparado ignorando o host; segmentos <span className="mono">:id</span> e <span className="mono">{'{{var}}'}</span> aceitam qualquer
        valor. Para escolher um exemplo específico, envie o header <span className="mono">x-mock-response-name</span> ou{' '}
        <span className="mono">x-mock-response-code</span>.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
        <span>Porta</span>
        <input
          className="input"
          type="number"
          style={{ width: 100 }}
          disabled={mock?.running}
          value={port}
          onChange={(e) => setPort(Math.max(0, +e.target.value))}
        />
        {mock?.running ? (
          <button className="btn" onClick={() => stopMock(collectionId)}>
            <Square size={13} /> Parar
          </button>
        ) : (
          <button className="btn primary" disabled={!examples} onClick={() => startMock(collectionId, port)}>
            <Server size={13} /> Iniciar mock
          </button>
        )}
        {mock?.running && (
          <>
            <span className="mono">{url}</span>
            <button className="icon-btn" title="Copiar URL" onClick={() => (navigator.clipboard.writeText(url), toast('URL copiada'))}>
              <Copy size={14} />
            </button>
            <span className="hint">{mock.routes} rotas</span>
          </>
        )}
      </div>
      {!examples && <div className="empty-hint">Esta coleção ainda não tem exemplos. Envie uma requisição e clique em “Salvar como exemplo” na resposta.</div>}
      {mock?.error && <p style={{ color: 'var(--err)' }}>{mock.error}</p>}
      {!!mock?.log.length && (
        <table className="hdr-table" style={{ marginTop: 8 }}>
          <tbody>
            {mock.log.map((l, i) => (
              <tr key={i}>
                <td className="hint" style={{ width: 60 }}>
                  {timeAgo(l.at)}
                </td>
                <td style={{ width: 70, color: methodColor(l.method), fontWeight: 600 }}>{l.method}</td>
                <td className="mono">{l.path}</td>
                <td style={{ width: 50, color: statusColor(l.code), fontWeight: 600 }}>{l.code}</td>
                <td className="hint">{l.example || (l.code === 404 ? 'sem exemplo' : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
