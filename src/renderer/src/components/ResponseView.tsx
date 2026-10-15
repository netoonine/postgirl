import { useMemo, useState } from 'react'
import { Copy, Download, Loader2, Save, SendHorizontal } from 'lucide-react'
import type { HttpResult } from '@shared/types'
import { api } from '../api'
import { toast } from '../store'
import { b64ToText, formatBytes, formatMs, prettyBody, STATUS_HINT, statusColor } from '../util'
import { CodeEditor } from './CodeEditor'
import { Segmented, SubTabs } from './ui'

type Tab = 'body' | 'cookies' | 'headers' | 'tests'
type BodyView = 'pretty' | 'raw' | 'preview' | 'visualize'

const PHASES: [string, string][] = [
  ['prepare', 'Preparação'],
  ['wait', 'Socket'],
  ['dns', 'DNS'],
  ['tcp', 'TCP'],
  ['secureHandshake', 'TLS'],
  ['firstByte', 'Primeiro byte'],
  ['download', 'Download'],
  ['process', 'Processamento']
]

function Timings({ timings, total }: { timings?: Record<string, number>; total: number }) {
  const [open, setOpen] = useState(false)
  const max = Math.max(1, ...Object.values(timings || {}))
  return (
    <span style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      Tempo: <b style={{ color: 'var(--ok)' }}>{formatMs(total)}</b>
      {open && timings && (
        <div className="timing-pop">
          {PHASES.filter(([k]) => timings[k] !== undefined).map(([k, label]) => (
            <div className="timing-row" key={k}>
              <span>{label}</span>
              <div className="timing-bar" style={{ width: `${(timings[k] / max) * 100}%` }} />
              <span style={{ textAlign: 'right' }}>{formatMs(timings[k])}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

export function ResponseView({
  result,
  loading,
  onCancel,
  onSaveExample
}: {
  result?: HttpResult
  loading?: boolean
  onCancel: () => void
  onSaveExample?: () => void
}) {
  const [tab, setTab] = useState<Tab>('body')
  const [view, setView] = useState<BodyView>('pretty')
  const r = result?.response

  const body = useMemo(() => {
    if (!r) return null
    const isImage = r.mime.startsWith('image/')
    const isPdf = r.mime.includes('pdf')
    const text = isImage || isPdf ? '' : b64ToText(r.bodyBase64)
    return { text, pretty: prettyBody(text, r.mime), isImage, isPdf, isHtml: r.mime.includes('html') }
  }, [r])

  if (loading)
    return (
      <div className="resp-empty">
        <Loader2 size={22} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
        Enviando requisição…
        <button className="btn sm" onClick={onCancel}>
          Cancelar
        </button>
        <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      </div>
    )

  if (!result)
    return (
      <div className="resp-empty">
        <SendHorizontal size={28} strokeWidth={1.4} />
        <div>Preencha a URL e clique em Enviar para ver a resposta.</div>
        <div>
          <span className="kbd">⌘</span> <span className="kbd">Enter</span>
        </div>
      </div>
    )

  const passed = result.tests.filter((t) => t.passed && !t.skipped).length

  const copy = () => {
    navigator.clipboard.writeText(view === 'raw' ? body!.text : body!.pretty.text)
    toast('Corpo copiado')
  }
  const download = () => {
    const ext = r!.mime.split('/')[1]?.split(/[;+]/)[0] || 'txt'
    api.saveFile(`resposta.${ext}`, r!.bodyBase64, true)
  }

  return (
    <div className="pane" style={{ flex: 1 }}>
      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'body', label: 'Corpo' },
          { id: 'cookies', label: <>Cookies {r?.cookies.length ? <span className="count">{r.cookies.length}</span> : null}</> },
          { id: 'headers', label: <>Headers {r ? <span className="count">{r.headers.length}</span> : null}</> },
          {
            id: 'tests',
            label: (
              <>
                Testes{' '}
                {result.tests.length > 0 && (
                  <span className="count" style={{ color: passed === result.tests.length ? 'var(--ok)' : 'var(--err)' }}>
                    {passed}/{result.tests.length}
                  </span>
                )}
              </>
            )
          }
        ]}
        right={
          r && (
            <div className="resp-meta">
              <span title={STATUS_HINT[r.code]}>
                Status:{' '}
                <b style={{ color: statusColor(r.code) }}>
                  {r.code} {r.status}
                </b>
              </span>
              <Timings timings={r.timings} total={r.time} />
              <span title={`Corpo ${formatBytes(r.size.body)} · Headers ${formatBytes(r.size.header)}`}>
                Tamanho: <b style={{ color: 'var(--ok)' }}>{formatBytes(r.size.total)}</b>
              </span>
              {onSaveExample && (
                <button className="icon-btn" title="Salvar como exemplo" onClick={onSaveExample}>
                  <Save size={14} />
                </button>
              )}
            </div>
          )
        }
      />

      {result.error && !r && (
        <div className="resp-error">
          <b>Não foi possível obter resposta</b>
          <div className="mono" style={{ marginTop: 6 }}>
            {result.error}
          </div>
          {result.sent && (
            <div className="mono" style={{ marginTop: 6, opacity: 0.8 }}>
              {result.sent.method} {result.sent.url}
            </div>
          )}
        </div>
      )}

      {tab === 'body' && r && body && (
        <div className="pane-body flush">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px' }}>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { id: 'pretty', label: 'Formatado' },
                { id: 'raw', label: 'Bruto' },
                { id: 'preview', label: 'Prévia' },
                ...(result.visualizer ? [{ id: 'visualize' as const, label: 'Visualizar' }] : [])
              ]}
            />
            <span className="hint">{r.mime}</span>
            <div className="spacer" />
            <button className="icon-btn" title="Copiar" onClick={copy}>
              <Copy size={14} />
            </button>
            <button className="icon-btn" title="Salvar em arquivo" onClick={download}>
              <Download size={14} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--border)' }}>
            {view === 'pretty' &&
              (body.isImage || body.isPdf ? (
                <Preview r={r} body={body} />
              ) : (
                <CodeEditor readOnly value={body.pretty.text} lang={body.pretty.lang} />
              ))}
            {view === 'raw' && <CodeEditor readOnly value={body.text} lang="text" />}
            {view === 'preview' && <Preview r={r} body={body} />}
            {view === 'visualize' &&
              (result.visualizer?.error ? (
                <div className="resp-error">{result.visualizer.error}</div>
              ) : (
                <iframe className="preview-frame" sandbox="allow-scripts" srcDoc={result.visualizer?.html} />
              ))}
          </div>
        </div>
      )}

      {tab === 'headers' && r && (
        <div className="pane-body">
          <table className="hdr-table">
            <tbody>
              {r.headers.map((h, i) => (
                <tr key={i}>
                  <td>{h.key}</td>
                  <td className="mono">{h.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.sent && (
            <>
              <div className="section-label" style={{ padding: '18px 0 6px' }}>
                Requisição enviada
              </div>
              <div className="mono selectable" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
                {result.sent.method} {result.sent.url}
              </div>
              <table className="hdr-table">
                <tbody>
                  {result.sent.headers.map((h, i) => (
                    <tr key={i}>
                      <td>{h.key}</td>
                      <td className="mono">{h.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {tab === 'cookies' && r && (
        <div className="pane-body">
          {r.cookies.length === 0 ? (
            <div className="hint">Nenhum cookie para este domínio.</div>
          ) : (
            <table className="hdr-table">
              <tbody>
                <tr>
                  <td>Nome</td>
                  <td>Valor</td>
                  <td>Domínio</td>
                  <td>Caminho</td>
                  <td>Expira</td>
                </tr>
                {r.cookies.map((c, i) => (
                  <tr key={i}>
                    <td>{c.key}</td>
                    <td className="mono">{c.value}</td>
                    <td>{c.domain}</td>
                    <td>{c.path}</td>
                    <td>{c.expires ? new Date(c.expires).toLocaleString('pt-BR') : 'Sessão'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'tests' && (
        <div className="pane-body tests-list">
          {result.tests.length === 0 ? (
            <div className="hint">Nenhum teste nesta requisição. Escreva testes na aba Scripts, em Pós-resposta.</div>
          ) : (
            result.tests.map((t, i) => (
              <div className="t" key={i}>
                <span className={`pill ${t.skipped ? 'skip' : t.passed ? 'pass' : 'fail'}`}>{t.skipped ? 'PULADO' : t.passed ? 'PASSOU' : 'FALHOU'}</span>
                <div>
                  <div>{t.name}</div>
                  {t.error && (
                    <div className="mono" style={{ color: 'var(--err)', marginTop: 2 }}>
                      {t.error}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function Preview({ r, body }: { r: NonNullable<HttpResult['response']>; body: { text: string; isImage: boolean; isPdf: boolean } }) {
  if (body.isImage)
    return (
      <div style={{ padding: 14, overflow: 'auto', height: '100%' }}>
        <img src={`data:${r.mime};base64,${r.bodyBase64}`} style={{ maxWidth: '100%' }} />
      </div>
    )
  if (body.isPdf) return <iframe className="preview-frame" src={`data:application/pdf;base64,${r.bodyBase64}`} />
  // sandbox sem allow-scripts: o HTML da resposta não executa código
  return <iframe className="preview-frame" sandbox="" srcDoc={body.text} />
}
