import { useEffect, useRef, useState } from 'react'
import { Download, FileUp, Play, Square } from 'lucide-react'
import type { RunnerEvent, TestResult } from '@shared/types'
import { api } from '../api'
import { addLogs, getCollection, getEnvironment, setGlobals, Tab, toast, updateCollection, updateEnvironment, useStore } from '../store'
import { findItem, formatBytes, formatMs, methodColor, parseCsv, statusColor, uid, walk } from '../util'

interface RunItem {
  iteration: number
  itemId: string
  name: string
  method: string
  url: string
  code?: number
  status?: string
  time?: number
  size?: number
  tests: TestResult[]
  error?: string
}

export function RunnerView({ tab }: { tab: Tab }) {
  useStore((s) => s.collections)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const col = getCollection(tab.collectionId)
  const folder = col && tab.itemId ? findItem(col.item, tab.itemId)?.item : null

  const [iterations, setIterations] = useState(1)
  const [delayMs, setDelayMs] = useState(0)
  const [persist, setPersist] = useState(true)
  const [stopOnError, setStopOnError] = useState(false)
  const [data, setData] = useState<{ name: string; rows: Record<string, any>[] } | null>(null)
  const [results, setResults] = useState<RunItem[]>([])
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all')
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const runId = useRef<string>('')

  useEffect(
    () =>
      api.onRunnerEvent((e: RunnerEvent) => {
        if (e.runId !== runId.current) return
        if (e.type === 'start') setTotal(e.total)
        if (e.type === 'item') setResults((r) => [...r, e])
        if (e.type === 'console') addLogs([{ id: uid(), at: e.entry.at, kind: 'console', level: e.entry.level, messages: e.entry.messages }])
        if (e.type === 'done') {
          setRunning(false)
          setElapsed(Date.now() - startedAtRef.current)
          if (e.error) toast(`Execução interrompida: ${e.error}`, 'error')
          const env = getEnvironment(useStore.getState().activeEnvId)
          if (env && e.environment) updateEnvironment(env.id, (x) => (x.values = e.environment!))
          if (e.globals) setGlobals(e.globals)
          if (col && e.collectionVariables) updateCollection(col.info._postman_id, (c) => (c.variable = e.collectionVariables))
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const startedAtRef = useRef(0)

  if (!col) return <div className="empty-hint">Coleção não encontrada.</div>

  let requestCount = 0
  walk(folder ? folder.item || [] : col.item, (it) => !it.item && !it.postgirl && requestCount++)

  const start = () => {
    runId.current = uid()
    setResults([])
    setTotal(requestCount * (data?.rows.length || iterations))
    setRunning(true)
    startedAtRef.current = Date.now()
    setStartedAt(Date.now())
    api.runnerStart({
      runId: runId.current,
      collection: col,
      folderId: tab.itemId,
      environment: getEnvironment(activeEnvId) || null,
      globals: useStore.getState().globals,
      iterations: data ? data.rows.length : iterations,
      delayMs,
      data: data?.rows,
      stopOnError,
      persistVariables: persist
    })
  }

  const loadData = async () => {
    const p = (await api.openFile({ title: 'Arquivo de dados (CSV ou JSON)', extensions: ['csv', 'json'] })) as string | null
    if (!p) return
    const text = await api.readText(p)
    try {
      const rows = p.endsWith('.json') ? JSON.parse(text) : parseCsv(text)
      if (!Array.isArray(rows)) throw new Error('O JSON precisa ser uma lista de objetos')
      setData({ name: p.split('/').pop()!, rows })
    } catch (e: any) {
      toast(`Arquivo inválido: ${e.message}`, 'error')
    }
  }

  const allTests = results.flatMap((r) => r.tests)
  const passed = allTests.filter((t) => t.passed && !t.skipped).length
  const failed = allTests.filter((t) => !t.passed && !t.skipped).length
  const errors = results.filter((r) => r.error).length
  const avg = results.length ? results.reduce((a, r) => a + (r.time || 0), 0) / results.length : 0
  const shown = results.filter((r) =>
    filter === 'all' ? true : filter === 'passed' ? r.tests.every((t) => t.passed) && !r.error : r.tests.some((t) => !t.passed && !t.skipped) || r.error
  )

  const exportResults = () =>
    api.saveFile(
      `${col.info.name}-run-${new Date().toISOString().slice(0, 19)}.json`,
      JSON.stringify({ collection: col.info.name, startedAt: new Date(startedAt).toISOString(), totals: { passed, failed, errors }, results }, null, 2)
    )

  return (
    <div className="request-view">
      <div className="page-head">
        <h2>
          Runner · {col.info.name}
          {folder ? ` / ${folder.name}` : ''}
        </h2>
      </div>
      <div className="progress">
        <div style={{ width: `${total ? Math.min(100, (results.length / total) * 100) : 0}%` }} />
      </div>
      <div className="runner-layout">
        <div className="runner-config">
          <div className="field">
            <span>Iterações</span>
            <input
              className="input"
              type="number"
              min={1}
              disabled={!!data}
              value={data ? data.rows.length : iterations}
              onChange={(e) => setIterations(Math.max(1, +e.target.value))}
            />
          </div>
          <div className="field">
            <span>Intervalo entre requisições (ms)</span>
            <input className="input" type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Math.max(0, +e.target.value))} />
          </div>
          <div className="field">
            <span>Dados (uma linha por iteração)</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn sm" onClick={loadData}>
                <FileUp size={13} /> CSV ou JSON
              </button>
              {data && (
                <>
                  <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {data.name} · {data.rows.length} linhas
                  </span>
                  <button className="btn ghost sm" onClick={() => setData(null)}>
                    Remover
                  </button>
                </>
              )}
            </div>
            <span className="hint">Cada coluna vira {'{{variavel}}'} e pm.iterationData.</span>
          </div>
          <label className="check" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} /> Guardar variáveis alteradas pelos scripts
          </label>
          <label className="check" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} /> Parar no primeiro erro
          </label>
          <p className="hint">
            Ambiente: <b>{getEnvironment(activeEnvId)?.name || 'nenhum'}</b>
            <br />
            {requestCount} requisições HTTP. WebSocket, MQTT, Socket.IO e gRPC não entram no Runner.
          </p>
          {running ? (
            <button className="btn" style={{ width: '100%' }} onClick={() => api.runnerStop(runId.current).then(() => setRunning(false))}>
              <Square size={13} /> Parar
            </button>
          ) : (
            <button className="btn primary" style={{ width: '100%' }} disabled={!requestCount} onClick={start}>
              <Play size={13} /> Executar {col.info.name}
            </button>
          )}
        </div>
        <div className="runner-results">
          {results.length === 0 && !running ? (
            <div className="empty-hint">Configure e clique em Executar. Os resultados aparecem aqui conforme cada requisição termina.</div>
          ) : (
            <>
              <div className="run-summary">
                <div>
                  <div className="big" style={{ color: 'var(--ok)' }}>
                    {passed}
                  </div>
                  <div className="hint">testes passaram</div>
                </div>
                <div>
                  <div className="big" style={{ color: failed ? 'var(--err)' : undefined }}>
                    {failed}
                  </div>
                  <div className="hint">falharam</div>
                </div>
                <div>
                  <div className="big" style={{ color: errors ? 'var(--err)' : undefined }}>
                    {errors}
                  </div>
                  <div className="hint">erros de rede</div>
                </div>
                <div>
                  <div className="big">{formatMs(avg)}</div>
                  <div className="hint">tempo médio</div>
                </div>
                {!running && elapsed > 0 && (
                  <div>
                    <div className="big">{formatMs(elapsed)}</div>
                    <div className="hint">duração</div>
                  </div>
                )}
                <div className="spacer" />
                <div className="segmented">
                  {(['all', 'passed', 'failed'] as const).map((f) => (
                    <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                      {{ all: 'Todos', passed: 'Passaram', failed: 'Falharam' }[f]}
                    </button>
                  ))}
                </div>
                <button className="icon-btn" title="Exportar resultados" onClick={exportResults}>
                  <Download size={15} />
                </button>
              </div>
              {shown.map((r, i) => (
                <div className="run-item" key={i}>
                  <div className="run-item-head">
                    <span className="hint" style={{ width: 28 }}>
                      #{r.iteration + 1}
                    </span>
                    <span className="method-badge" style={{ color: methodColor(r.method), textAlign: 'left' }}>
                      {r.method}
                    </span>
                    <b style={{ fontWeight: 550 }}>{r.name}</b>
                    <span className="hint mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {r.url}
                    </span>
                    {r.error ? (
                      <span style={{ color: 'var(--err)' }}>{r.error}</span>
                    ) : (
                      <>
                        <span style={{ color: statusColor(r.code), fontWeight: 600 }}>
                          {r.code} {r.status}
                        </span>
                        <span className="hint">{formatMs(r.time)}</span>
                        <span className="hint">{formatBytes(r.size)}</span>
                      </>
                    )}
                  </div>
                  {r.tests.length > 0 && (
                    <div className="tests">
                      {r.tests.map((t, j) => (
                        <div key={j}>
                          <span className={`pill ${t.skipped ? 'skip' : t.passed ? 'pass' : 'fail'}`}>
                            {t.skipped ? 'PULADO' : t.passed ? 'PASSOU' : 'FALHOU'}
                          </span>
                          {t.name}
                          {t.error && <span style={{ color: 'var(--err)' }}> · {t.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
