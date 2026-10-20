import { Eye, EyeOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { EnvValue } from '@shared/types'
import { getEnvironment, setActiveEnv, setGlobals, Tab, updateEnvironment, useStore } from '../store'

function EnvTable({ values, onChange }: { values: EnvValue[]; onChange: (v: EnvValue[]) => void }) {
  const [reveal, setReveal] = useState<Record<number, boolean>>({})
  const rows = [...values, { key: '', value: '', enabled: true, type: 'default' } as EnvValue]
  const update = (i: number, patch: Partial<EnvValue>) => {
    const next = values.slice()
    if (i >= values.length) next.push({ key: '', value: '', enabled: true, type: 'default', ...patch })
    else next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  return (
    <table className="kv">
      <thead>
        <tr>
          <th className="c-check" />
          <th>Variável</th>
          <th style={{ width: 110 }}>Tipo</th>
          <th>Valor</th>
          <th className="c-act" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const isNew = i >= values.length
          const secret = r.type === 'secret'
          return (
            <tr key={i} className={r.enabled === false ? 'disabled' : ''}>
              <td className="c-check">
                {!isNew && <input type="checkbox" checked={r.enabled !== false} onChange={(e) => update(i, { enabled: e.target.checked })} />}
              </td>
              <td>
                <input
                  className="cell-input"
                  value={r.key}
                  placeholder={isNew ? 'Adicionar variável' : ''}
                  onChange={(e) => update(i, { key: e.target.value })}
                />
              </td>
              <td>
                {!isNew && (
                  <select
                    className="mini-select"
                    style={{ padding: '0 6px' }}
                    value={secret ? 'secret' : 'default'}
                    onChange={(e) => update(i, { type: e.target.value as any })}
                  >
                    <option value="default">padrão</option>
                    <option value="secret">secreto</option>
                  </select>
                )}
              </td>
              <td>
                <div className="cell-flex">
                  <input
                    className="cell-input mono"
                    type={secret && !reveal[i] ? 'password' : 'text'}
                    value={r.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                  {secret && (
                    <button className="icon-btn sm" onClick={() => setReveal({ ...reveal, [i]: !reveal[i] })}>
                      {reveal[i] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  )}
                </div>
              </td>
              <td className="c-act">
                {!isNew && (
                  <button className="icon-btn sm row-del" onClick={() => onChange(values.filter((_, j) => j !== i))}>
                    <Trash2 size={13} />
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function EnvironmentView({ tab }: { tab: Tab }) {
  useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const env = getEnvironment(tab.envId)
  if (!env) return <div className="empty-hint">Ambiente não encontrado.</div>
  return (
    <div className="request-view">
      <div className="page-head">
        <input className="inline-edit" value={env.name} onChange={(e) => updateEnvironment(env.id, (x) => (x.name = e.target.value))} />
        {activeEnvId === env.id ? (
          <button className="btn sm" onClick={() => setActiveEnv(null)}>
            Desativar
          </button>
        ) : (
          <button className="btn primary sm" onClick={() => setActiveEnv(env.id)}>
            Usar este ambiente
          </button>
        )}
      </div>
      <div className="pane-body">
        <EnvTable values={env.values} onChange={(v) => updateEnvironment(env.id, (x) => (x.values = v))} />
        <p className="hint">
          Use como {'{{nome}}'} em URLs, headers, corpo e autenticação. Scripts alteram valores com pm.environment.set(). Valores do tipo secreto ficam no
          Keychain do sistema, não no arquivo do ambiente: a pasta de trabalho pode ir para o git sem vazar tokens.
        </p>
      </div>
    </div>
  )
}

export function GlobalsView() {
  const globals = useStore((s) => s.globals)
  return (
    <div className="request-view">
      <div className="page-head">
        <h2>Variáveis globais</h2>
      </div>
      <div className="pane-body">
        <EnvTable values={globals} onChange={setGlobals} />
        <p className="hint">
          Valem em qualquer coleção e ambiente, com a menor prioridade. Scripts alteram com pm.globals.set(). Valores secretos ficam no Keychain do sistema.
        </p>
      </div>
    </div>
  )
}
