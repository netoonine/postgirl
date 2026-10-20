import { useMemo, useState } from 'react'
import { ChevronRight, Code2, Save } from 'lucide-react'
import type { PMItem, PMRequest } from '@shared/types'
import { api } from '../api'
import { cancelTab, getCollection, getEnvironment, openModal, saveTab, sendTab, Tab, toast, updateDraft, useStore } from '../store'
import { b64ToText, effectiveAuth, findItem, getScript, METHODS, methodColor, uid, urlFromQuery, urlFromRaw, variableMap } from '../util'
import { AuthEditor } from './AuthEditor'
import { BodyEditor } from './BodyEditor'
import { KVTable } from './KVTable'
import { ResponseView } from './ResponseView'
import { ScriptsEditor } from './ScriptsEditor'
import { SubTabs, useResizable } from './ui'
import { VarInput, VarsContext } from './VarInput'

type ReqTab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings' | 'docs'

export function useVars(collectionId?: string) {
  const globals = useStore((s) => s.globals)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const environments = useStore((s) => s.environments)
  const collections = useStore((s) => s.collections)
  return useMemo(
    () => variableMap(globals, getCollection(collectionId)?.variable, getEnvironment(activeEnvId)?.values),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [globals, activeEnvId, environments, collections, collectionId]
  )
}

export function useLocation(tab: Tab) {
  const collections = useStore((s) => s.collections)
  return useMemo(() => {
    const col = collections.find((c) => c.info._postman_id === tab.collectionId)
    const found = col && tab.itemId ? findItem(col.item, tab.itemId) : null
    return { col, ancestors: found?.ancestors || [] }
  }, [collections, tab.collectionId, tab.itemId])
}

export function RequestView({ tab }: { tab: Tab }) {
  const [sub, setSub] = useState<ReqTab>('params')
  const layout = useStore((s) => s.settings.layout)
  const vertical = layout === 'vertical'
  const split = useResizable(vertical ? 'req-v' : 'req-h', vertical ? 300 : 620, 120, 2000, vertical ? 'y' : 'x')
  const vars = useVars(tab.collectionId)
  const { col, ancestors } = useLocation(tab)

  const draft = tab.draft!
  const req = draft.request!
  const setReq = (fn: (r: PMRequest) => void) => updateDraft(tab.id, (d) => fn(d.request!))
  const setItem = (fn: (d: PMItem) => void) => updateDraft(tab.id, fn)

  const inherited = effectiveAuth(col, ancestors, null)
  const query = req.url.query || []
  const pathVars = req.url.variable || []
  const enabledHeaders = req.header.filter((h) => !h.disabled).length
  const hasBody = req.body?.mode && req.body.mode !== 'none'
  const scripts = [getScript(draft.event, 'prerequest'), getScript(draft.event, 'test')].filter((s) => s.trim()).length

  const onPaste = async (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (!/^\s*curl\s/i.test(text)) return
    e.preventDefault()
    try {
      const r = await api.importCurl(text)
      setItem((d) => (d.request = { ...r, auth: d.request?.auth }))
      toast('Comando cURL importado')
    } catch (err: any) {
      toast(`cURL inválido: ${err.message}`, 'error')
    }
  }

  const saveExample = () => {
    const r = tab.result?.response
    if (!r) return
    setItem((d) => {
      d.response = [
        ...(d.response || []),
        {
          id: uid(),
          name: `Exemplo ${r.code} ${new Date().toLocaleString('pt-BR')}`,
          originalRequest: d.request,
          status: r.status,
          code: r.code,
          header: r.headers,
          body: b64ToText(r.bodyBase64),
          _postman_previewlanguage: r.mime.includes('json') ? 'json' : r.mime.includes('html') ? 'html' : 'text'
        }
      ]
    })
    toast('Exemplo adicionado. Salve a requisição para gravar.')
  }

  const ppb = draft.protocolProfileBehavior || {}
  const setPpb = (k: string, v: boolean | undefined) =>
    setItem((d) => {
      d.protocolProfileBehavior = { ...d.protocolProfileBehavior, [k]: v }
      if (v === undefined) delete d.protocolProfileBehavior![k]
    })

  const requestPane = (
    <div className="pane" style={vertical ? { height: split.size } : { width: split.size }}>
      <SubTabs
        value={sub}
        onChange={setSub}
        tabs={[
          {
            id: 'params',
            label: (
              <>
                Params{' '}
                {query.filter((q) => !q.disabled).length + pathVars.length > 0 && (
                  <span className="count">{query.filter((q) => !q.disabled).length + pathVars.length}</span>
                )}
              </>
            )
          },
          { id: 'auth', label: <>Autorização {req.auth && req.auth.type !== 'noauth' && <span className="count">•</span>}</> },
          { id: 'headers', label: <>Headers {enabledHeaders > 0 && <span className="count">{enabledHeaders}</span>}</> },
          { id: 'body', label: <>Corpo {hasBody && <span className="count">•</span>}</> },
          { id: 'scripts', label: <>Scripts {scripts > 0 && <span className="count">{scripts}</span>}</> },
          { id: 'settings', label: 'Opções' },
          { id: 'docs', label: 'Docs' }
        ]}
      />
      <div className="pane-body" style={sub === 'body' || sub === 'scripts' ? { display: 'flex', flexDirection: 'column' } : undefined}>
        {sub === 'params' && (
          <>
            <KVTable title="Query params" rows={query} onChange={(rows) => setReq((r) => (r.url = urlFromQuery(r.url, rows)))} />
            {pathVars.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <KVTable
                  title="Variáveis de caminho"
                  rows={pathVars}
                  readOnlyKeys
                  noAdd
                  onChange={(rows) => setReq((r) => (r.url = { ...r.url, variable: rows }))}
                />
              </div>
            )}
          </>
        )}
        {sub === 'auth' && (
          <AuthEditor
            auth={req.auth}
            onChange={(a) => setReq((r) => (a ? (r.auth = a) : delete r.auth))}
            inheritedFrom={{ type: inherited.auth?.type, from: inherited.from }}
          />
        )}
        {sub === 'headers' && (
          <>
            <KVTable title="Headers" rows={req.header} onChange={(rows) => setReq((r) => (r.header = rows))} />
            <p className="hint" style={{ marginTop: 10 }}>
              Content-Type, User-Agent, Host, Content-Length e Accept são preenchidos automaticamente no envio quando não informados. Veja os headers efetivos
              na aba Headers da resposta.
            </p>
          </>
        )}
        {sub === 'body' && <BodyEditor body={req.body} onChange={(b) => setReq((r) => (r.body = b))} />}
        {sub === 'scripts' && <ScriptsEditor events={draft.event} onChange={(ev) => setItem((d) => (d.event = ev))} />}
        {sub === 'settings' && (
          <div className="form-grid">
            {(
              [
                ['followRedirects', 'Seguir redirecionamentos', 'Padrão: configuração global'],
                ['strictSSL', 'Verificar certificado SSL', 'Padrão: configuração global'],
                ['disableBodyPruning', 'Enviar corpo em GET/HEAD', 'Por padrão o corpo é descartado nesses métodos'],
                ['disableCookies', 'Não usar o cookie jar', 'Não envia nem guarda cookies desta requisição'],
                ['followOriginalHttpMethod', 'Manter método ao redirecionar', 'Por padrão vira GET após 301/302'],
                ['followAuthorizationHeader', 'Manter Authorization ao redirecionar', 'Por padrão é removido em outro host']
              ] as const
            ).map(([k, label, hint]) => (
              <SettingRow key={k} label={label} hint={hint} value={ppb[k]} onChange={(v) => setPpb(k, v)} />
            ))}
          </div>
        )}
        {sub === 'docs' && (
          <textarea
            className="textarea"
            style={{ width: '100%', minHeight: 240 }}
            placeholder="Descreva esta requisição (Markdown)"
            value={req.description || ''}
            onChange={(e) => setReq((r) => (r.description = e.target.value))}
          />
        )}
      </div>
    </div>
  )

  return (
    <VarsContext.Provider value={vars}>
      <div className="request-view">
        <div className="req-header">
          <div className="breadcrumb">
            {col && (
              <>
                <span>{col.info.name}</span>
                {ancestors.map((a) => (
                  <span key={a.id} style={{ display: 'contents' }}>
                    <ChevronRight size={12} />
                    <span>{a.name}</span>
                  </span>
                ))}
                <ChevronRight size={12} />
              </>
            )}
            <input
              className="inline-edit"
              style={{ fontSize: 13, fontWeight: 600, padding: '2px 4px' }}
              value={draft.name}
              onChange={(e) => setItem((d) => (d.name = e.target.value))}
            />
          </div>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={() => openModal('codegen', { tabId: tab.id })}>
            <Code2 size={14} /> Código
          </button>
          <button className="btn sm" onClick={() => saveTab(tab.id)}>
            <Save size={14} /> Salvar
          </button>
        </div>
        <div className="urlbar" onPasteCapture={onPaste}>
          <div className="urlbar-field">
            <select
              className="method-select"
              style={{ color: methodColor(req.method) }}
              value={METHODS.includes(req.method as any) ? req.method : '__custom'}
              onChange={async (e) => {
                let m = e.target.value
                if (m === '__custom')
                  m = ((await openModal<string>('prompt', { title: 'Método personalizado', value: 'PROPFIND', label: 'Método' })) || req.method).toUpperCase()
                setReq((r) => (r.method = m))
              }}
            >
              {METHODS.map((m) => (
                <option key={m} value={m} style={{ color: methodColor(m) }}>
                  {m}
                </option>
              ))}
              {!METHODS.includes(req.method as any) && <option value={req.method}>{req.method}</option>}
              <option value="__custom">Outro…</option>
            </select>
            <VarInput
              value={req.url.raw}
              placeholder="Digite a URL ou cole um comando cURL"
              onChange={(raw) => setReq((r) => (r.url = urlFromRaw(raw, r.url)))}
              onEnter={() => sendTab(tab.id)}
              autoFocus={!req.url.raw}
            />
          </div>
          {tab.loading ? (
            <button className="btn" style={{ width: 96 }} onClick={() => cancelTab(tab.id)}>
              Cancelar
            </button>
          ) : (
            <button className="btn primary" style={{ width: 96 }} onClick={() => sendTab(tab.id)}>
              Enviar
            </button>
          )}
        </div>
        <div className={`split${vertical ? ' vertical' : ''}`} style={{ borderTop: '1px solid var(--border)' }}>
          {requestPane}
          <div className={`${vertical ? 'resizer-h' : 'resizer'}${split.dragging ? ' dragging' : ''}`} onMouseDown={split.onMouseDown} />
          <div
            className="pane"
            style={{ flex: 1, borderTop: vertical ? '1px solid var(--border)' : undefined, borderLeft: vertical ? undefined : '1px solid var(--border)' }}
          >
            <ResponseView result={tab.result} loading={tab.loading} onCancel={() => cancelTab(tab.id)} onSaveExample={saveExample} />
          </div>
        </div>
      </div>
    </VarsContext.Provider>
  )
}

function SettingRow({ label, hint, value, onChange }: { label: string; hint: string; value?: boolean; onChange: (v: boolean | undefined) => void }) {
  return (
    <>
      <label>
        {label}
        <div className="hint">{hint}</div>
      </label>
      <select
        className="select"
        style={{ width: 200 }}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
      >
        <option value="">Padrão</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    </>
  )
}
