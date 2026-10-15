import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Folder, Library, Trash2 } from 'lucide-react'
import type { CodegenLanguage, CookieInfo, ImportResult, PMItem } from '@shared/types'
import { api } from '../api'
import {
  addCollection,
  addEnvironment,
  chooseWorkspace,
  closeModal,
  createCollection,
  getCollection,
  getEnvironment,
  openCollectionTab,
  toast,
  updateSettings,
  useStore
} from '../store'
import { effectiveAuth, findItem } from '../util'
import { CodeEditor } from './CodeEditor'
import { Modal } from './ui'

function PromptModal({ title, value, label }: { title: string; value: string; label?: string }) {
  const [v, setV] = useState(value)
  const ok = () => v.trim() && closeModal(v.trim())
  return (
    <Modal
      title={title}
      onClose={() => closeModal(undefined)}
      footer={
        <>
          <button className="btn" onClick={() => closeModal(undefined)}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!v.trim()} onClick={ok}>
            OK
          </button>
        </>
      }
    >
      <label className="field">
        {label && <span>{label}</span>}
        <input className="input" autoFocus value={v} onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      </label>
    </Modal>
  )
}

function ConfirmModal({ title, message, danger, okLabel }: { title: string; message: string; danger?: boolean; okLabel: string }) {
  return (
    <Modal
      title={title}
      onClose={() => closeModal(false)}
      footer={
        <>
          <button className="btn" onClick={() => closeModal(false)}>
            Cancelar
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} autoFocus onClick={() => closeModal(true)}>
            {okLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, lineHeight: 1.5 }}>{message}</p>
    </Modal>
  )
}

function UnsavedModal({ name }: { name?: string }) {
  return (
    <Modal
      title="Alterações não salvas"
      onClose={() => closeModal(undefined)}
      footer={
        <>
          <button className="btn" onClick={() => closeModal('discard')}>
            Descartar
          </button>
          <div className="spacer" />
          <button className="btn" onClick={() => closeModal(undefined)}>
            Cancelar
          </button>
          <button className="btn primary" autoFocus onClick={() => closeModal('save')}>
            Salvar
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>“{name}” tem alterações que não foram salvas. Salvar antes de fechar?</p>
    </Modal>
  )
}

function FolderPicker({ value, onChange }: { value: { collectionId: string; parentId: string | null } | null; onChange: (v: { collectionId: string; parentId: string | null }) => void }) {
  const collections = useStore((s) => s.collections)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const row = (key: string, depth: number, label: string, icon: React.ReactNode, sel: boolean, hasKids: boolean, onClick: () => void) => (
    <div className={`tree-row${sel ? ' active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={onClick}>
      <span
        className="chev"
        onClick={(e) => {
          e.stopPropagation()
          setOpen({ ...open, [key]: !open[key] })
        }}
      >
        {hasKids ? open[key] ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
      </span>
      {icon}
      <span className="name">{label}</span>
    </div>
  )
  const folders = (items: PMItem[], colId: string, depth: number): React.ReactNode =>
    items
      .filter((i) => i.item)
      .map((f) => (
        <div key={f.id}>
          {row(f.id, depth, f.name, <Folder size={14} color="var(--fg-muted)" />, value?.parentId === f.id, !!f.item!.some((x) => x.item), () => onChange({ collectionId: colId, parentId: f.id }))}
          {open[f.id] && folders(f.item!, colId, depth + 1)}
        </div>
      ))
  return (
    <div className="picker-tree">
      {collections.map((c) => (
        <div key={c.info._postman_id}>
          {row(
            c.info._postman_id,
            0,
            c.info.name,
            <Library size={14} color="var(--fg-muted)" />,
            value?.collectionId === c.info._postman_id && !value.parentId,
            c.item.some((x) => x.item),
            () => onChange({ collectionId: c.info._postman_id, parentId: null })
          )}
          {open[c.info._postman_id] && folders(c.item, c.info._postman_id, 1)}
        </div>
      ))}
      {!collections.length && <div className="empty-hint">Nenhuma coleção. Crie uma para salvar.</div>}
    </div>
  )
}

function SaveRequestModal({ name }: { name: string }) {
  const [n, setN] = useState(name)
  const collections = useStore((s) => s.collections)
  const [target, setTarget] = useState<{ collectionId: string; parentId: string | null } | null>(
    collections[0] ? { collectionId: collections[0].info._postman_id, parentId: null } : null
  )
  const ok = () => target && n.trim() && closeModal({ ...target, name: n.trim() })
  return (
    <Modal
      title="Salvar requisição"
      onClose={() => closeModal(undefined)}
      footer={
        <>
          <button
            className="btn ghost"
            onClick={async () => {
              const before = useStore.getState().collections.length
              const m = useStore.getState().modal
              await createCollection()
              // createCollection fechou este modal: reabre com a coleção nova selecionada
              const cols = useStore.getState().collections
              if (cols.length > before && m) useStore.setState({ modal: m })
            }}
          >
            Nova coleção
          </button>
          <div className="spacer" />
          <button className="btn" onClick={() => closeModal(undefined)}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!target || !n.trim()} onClick={ok}>
            Salvar
          </button>
        </>
      }
    >
      <label className="field">
        <span>Nome</span>
        <input className="input" autoFocus value={n} placeholder="Ex.: Listar usuários" onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      </label>
      <div className="field">
        <span>Salvar em</span>
        <FolderPicker value={target} onChange={setTarget} />
      </div>
    </Modal>
  )
}

function ImportModal() {
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = (r: ImportResult | null) => {
    if (!r) return
    r.collections.forEach((c) => addCollection(c))
    r.environments.forEach((e) => addEnvironment(e))
    r.errors.forEach((e) => toast(e, 'error'))
    const n = r.collections.length + r.environments.length
    if (n) {
      toast(`Importado: ${r.collections.length} coleç${r.collections.length === 1 ? 'ão' : 'ões'}, ${r.environments.length} ambiente(s)`)
      if (r.collections.length === 1) openCollectionTab(r.collections[0].info._postman_id)
      closeModal()
    }
  }
  const run = async (fn: () => Promise<ImportResult | null>) => {
    setBusy(true)
    try {
      apply(await fn())
    } catch (e: any) {
      toast(e.message || String(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = [...e.dataTransfer.files]
    run(async () => {
      const merged: ImportResult = { collections: [], environments: [], errors: [] }
      for (const f of files) {
        const r = await api.importText(await f.text(), f.name)
        merged.collections.push(...r.collections)
        merged.environments.push(...r.environments)
        merged.errors.push(...r.errors)
      }
      return merged
    })
  }

  return (
    <Modal
      title="Importar"
      wide
      onClose={() => closeModal()}
      footer={
        <>
          <button className="btn" onClick={() => closeModal()}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!text.trim() || busy} onClick={() => run(() => api.importText(text))}>
            Importar texto
          </button>
        </>
      }
    >
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        Arraste arquivos aqui ou{' '}
        <button className="btn sm" disabled={busy} onClick={() => run(() => api.importFiles())}>
          escolha arquivos
        </button>
        <br />
        Coleções Postman (v1, v2.0, v2.1), ambientes, backup completo do Postman (Export data), OpenAPI 3 / Swagger 2 em JSON ou YAML.
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <span>Ou cole aqui: JSON, YAML ou um comando cURL</span>
        <textarea className="textarea mono" rows={8} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="curl https://api.exemplo.com/users -H 'Authorization: Bearer …'" />
      </div>
    </Modal>
  )
}

function CodegenModal({ tabId }: { tabId: string }) {
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId))
  const [langs, setLangs] = useState<CodegenLanguage[]>([])
  const [sel, setSel] = useState(() => {
    try {
      return localStorage.getItem('postgirl.codegen') || 'curl|cURL'
    } catch {
      return 'curl|cURL'
    }
  })
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const globals = useStore((s) => s.globals)
  const activeEnvId = useStore((s) => s.activeEnvId)

  useEffect(() => {
    api.codegenLanguages().then(setLangs)
  }, [])

  const col = getCollection(tab?.collectionId)
  const ancestors = useMemo(() => (col && tab?.itemId ? findItem(col.item, tab.itemId)?.ancestors || [] : []), [col, tab?.itemId])

  useEffect(() => {
    if (!tab?.draft?.request) return
    const [lang, variant] = sel.split('|')
    try {
      localStorage.setItem('postgirl.codegen', sel)
    } catch {
      /* preferência só não é lembrada */
    }
    api
      .codegen({
        request: tab.draft.request,
        auth: effectiveAuth(col, ancestors, tab.draft.request.auth).auth,
        lang,
        variant,
        variables: [...globals, ...(col?.variable || []), ...(getEnvironment(activeEnvId)?.values || [])]
      })
      .then((c) => {
        setCode(c)
        setErr('')
      })
      .catch((e) => setErr(e.message || String(e)))
  }, [sel, tab?.draft, globals, activeEnvId, col, ancestors])

  const syntax = langs.find((l) => l.key === sel.split('|')[0])?.syntax_mode || 'text'
  const editorLang = syntax === 'javascript' || syntax === 'typescript' ? 'javascript' : syntax === 'json' ? 'json' : 'text'

  return (
    <Modal
      title="Código"
      wide
      onClose={() => closeModal()}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            Variáveis do ambiente ativo já substituídas.
          </span>
          <button
            className="btn primary"
            onClick={() => {
              navigator.clipboard.writeText(code)
              toast('Código copiado')
            }}
          >
            <Copy size={14} /> Copiar
          </button>
        </>
      }
    >
      <select className="select" style={{ marginBottom: 10, width: 300 }} value={sel} onChange={(e) => setSel(e.target.value)}>
        {langs.map((l) => (
          <optgroup key={l.key} label={l.label}>
            {l.variants.map((v) => (
              <option key={v.key} value={`${l.key}|${v.key}`}>
                {l.label} · {v.key}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {err ? (
        <div className="resp-error" style={{ margin: 0 }}>
          {err}
        </div>
      ) : (
        <div className="editor-box" style={{ height: 420 }}>
          <CodeEditor readOnly value={code} lang={editorLang} wrap={false} />
        </div>
      )}
    </Modal>
  )
}

function SettingsModal() {
  const settings = useStore((s) => s.settings)
  const workspacePath = useStore((s) => s.workspacePath)
  return (
    <Modal
      title="Configurações"
      wide
      onClose={() => closeModal()}
      footer={
        <button className="btn primary" onClick={() => closeModal()}>
          Fechar
        </button>
      }
    >
      <div className="form-grid">
        <label>Pasta de trabalho</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {workspacePath}
          </span>
          <button className="btn sm" onClick={() => (closeModal(), chooseWorkspace())}>
            Trocar…
          </button>
        </div>
        <label>Tema</label>
        <select className="select" value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as any })}>
          <option value="system">Seguir o sistema</option>
          <option value="light">Claro</option>
          <option value="dark">Escuro</option>
        </select>
        <label>Layout da requisição</label>
        <select className="select" value={settings.layout} onChange={(e) => updateSettings({ layout: e.target.value as any })}>
          <option value="vertical">Resposta embaixo</option>
          <option value="horizontal">Resposta ao lado</option>
        </select>
        <label>Seguir redirecionamentos</label>
        <input type="checkbox" checked={settings.followRedirects} onChange={(e) => updateSettings({ followRedirects: e.target.checked })} />
        <label>
          Verificar certificados SSL
          <div className="hint">Desligado aceita certificados autoassinados (útil em localhost).</div>
        </label>
        <input type="checkbox" checked={settings.strictSSL} onChange={(e) => updateSettings({ strictSSL: e.target.checked })} />
        <label>Timeout da requisição (ms)</label>
        <input className="input" type="number" min={0} value={settings.timeoutMs} onChange={(e) => updateSettings({ timeoutMs: Math.max(0, +e.target.value) })} placeholder="0 = sem limite" />
        <label>Tamanho máximo da resposta (MB)</label>
        <input className="input" type="number" min={1} value={settings.maxResponseMB} onChange={(e) => updateSettings({ maxResponseMB: Math.max(1, +e.target.value) })} />
      </div>
    </Modal>
  )
}

function CookiesModal() {
  const [cookies, setCookies] = useState<CookieInfo[]>([])
  const [domain, setDomain] = useState<string | null>(null)
  const load = () => api.listCookies().then(setCookies)
  useEffect(() => {
    load()
  }, [])
  const domains = [...new Set(cookies.map((c) => c.domain))].sort()
  const shown = cookies.filter((c) => !domain || c.domain === domain)
  return (
    <Modal
      title="Cookies"
      wide
      onClose={() => closeModal()}
      footer={
        <>
          <button className="btn danger" style={{ marginRight: 'auto' }} disabled={!cookies.length} onClick={() => api.clearCookies(domain || undefined).then(load)}>
            {domain ? `Apagar cookies de ${domain}` : 'Apagar todos'}
          </button>
          <button className="btn primary" onClick={() => closeModal()}>
            Fechar
          </button>
        </>
      }
    >
      {cookies.length === 0 ? (
        <div className="empty-hint">Nenhum cookie guardado. Cookies recebidos nas respostas aparecem aqui e são reenviados automaticamente.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
          <div className="picker-tree">
            <div className={`tree-row${!domain ? ' active' : ''}`} onClick={() => setDomain(null)}>
              <span className="name">Todos ({cookies.length})</span>
            </div>
            {domains.map((d) => (
              <div key={d} className={`tree-row${domain === d ? ' active' : ''}`} onClick={() => setDomain(d)}>
                <span className="name">{d}</span>
              </div>
            ))}
          </div>
          <table className="hdr-table">
            <tbody>
              {shown.map((c) => (
                <tr key={`${c.domain}${c.path}${c.key}`}>
                  <td>
                    {c.key}
                    <div className="hint">
                      {c.domain}
                      {c.path}
                    </div>
                  </td>
                  <td className="mono">{c.value}</td>
                  <td style={{ width: 30 }}>
                    <button className="icon-btn sm" onClick={() => api.deleteCookie(c.domain, c.path, c.key).then(() => setTimeout(load, 50))}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

export function Modals() {
  const modal = useStore((s) => s.modal)
  if (!modal) return null
  const p = modal.props || {}
  switch (modal.type) {
    case 'prompt':
      return <PromptModal {...p} />
    case 'confirm':
      return <ConfirmModal {...p} />
    case 'unsaved':
      return <UnsavedModal {...p} />
    case 'save-request':
      return <SaveRequestModal {...p} />
    case 'import':
      return <ImportModal />
    case 'codegen':
      return <CodegenModal {...p} />
    case 'settings':
      return <SettingsModal />
    case 'cookies':
      return <CookiesModal />
  }
  return null
}
