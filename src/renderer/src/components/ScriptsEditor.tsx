import { useState } from 'react'
import type { PMEvent } from '@shared/types'
import { getScript, setScript } from '../util'
import { CodeEditor } from './CodeEditor'
import { Segmented } from './ui'

const SNIPPETS: Record<'prerequest' | 'test', [string, string][]> = {
  prerequest: [
    ['Ler variável de ambiente', 'pm.environment.get("variable_key");'],
    ['Definir variável de ambiente', 'pm.environment.set("variable_key", "variable_value");'],
    ['Definir variável da coleção', 'pm.collectionVariables.set("variable_key", "variable_value");'],
    ['Definir variável global', 'pm.globals.set("variable_key", "variable_value");'],
    ['Timestamp atual em variável', 'pm.variables.set("now", Date.now());'],
    ['Adicionar header', 'pm.request.headers.upsert({ key: "X-Custom", value: "valor" });'],
    [
      'Enviar outra requisição',
      'pm.sendRequest("https://postman-echo.com/get", function (err, response) {\n    console.log(response.json());\n});'
    ],
    ['Pular esta requisição', 'pm.execution.skipRequest();']
  ],
  test: [
    ['Status é 200', 'pm.test("Status é 200", function () {\n    pm.response.to.have.status(200);\n});'],
    ['Tempo de resposta < 500 ms', 'pm.test("Responde em menos de 500 ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(500);\n});'],
    ['Corpo contém texto', 'pm.test("Corpo contém texto", function () {\n    pm.expect(pm.response.text()).to.include("texto");\n});'],
    ['Valor no JSON', 'pm.test("Valor no JSON", function () {\n    const data = pm.response.json();\n    pm.expect(data.value).to.eql(100);\n});'],
    ['Header Content-Type existe', 'pm.test("Tem Content-Type", function () {\n    pm.response.to.have.header("Content-Type");\n});'],
    ['Salvar campo do JSON no ambiente', 'const data = pm.response.json();\npm.environment.set("token", data.token);'],
    [
      'Validar JSON Schema',
      'const schema = {\n    type: "object",\n    required: ["id"],\n    properties: { id: { type: "number" } }\n};\n\npm.test("Schema válido", function () {\n    pm.response.to.have.jsonSchema(schema);\n});'
    ],
    [
      'Visualizar como tabela',
      'const data = pm.response.json();\nconst rows = Object.entries(data).map(([chave, valor]) => ({ chave, valor: JSON.stringify(valor) }));\n\nconst template = `\n<table border="1" cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">\n  <tr><th>Chave</th><th>Valor</th></tr>\n  {{#each rows}}<tr><td>{{chave}}</td><td>{{valor}}</td></tr>{{/each}}\n</table>`;\n\npm.visualizer.set(template, { rows });'
    ],
    ['Próxima requisição no Runner', 'pm.execution.setNextRequest("Nome da requisição");']
  ]
}

export function ScriptsEditor({ events, onChange }: { events?: PMEvent[]; onChange: (e: PMEvent[]) => void }) {
  const [which, setWhich] = useState<'prerequest' | 'test'>('prerequest')
  const code = getScript(events, which)
  const has = (l: 'prerequest' | 'test') => !!getScript(events, l).trim()

  const insert = (snippet: string) => onChange(setScript(events, which, code ? `${code.replace(/\n*$/, '')}\n\n${snippet}` : snippet))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Segmented
          value={which}
          onChange={setWhich}
          options={[
            { id: 'prerequest', label: `Pré-requisição${has('prerequest') ? ' •' : ''}` },
            { id: 'test', label: `Pós-resposta${has('test') ? ' •' : ''}` }
          ]}
        />
        <span className="hint">
          {which === 'prerequest' ? 'Roda antes do envio.' : 'Roda depois da resposta: testes, extrair valores, visualizar.'} API pm.* compatível com o Postman.
        </span>
      </div>
      <div className="scripts-layout" style={{ flex: 1, minHeight: 0 }}>
        <div className="editor-box">
          <CodeEditor key={which} value={code} lang="javascript" wrap={false} onChange={(v) => onChange(setScript(events, which, v))} />
        </div>
        <div className="snippets">
          <div className="hint" style={{ marginBottom: 4 }}>
            Trechos prontos
          </div>
          {SNIPPETS[which].map(([label, snippet]) => (
            <a key={label} onClick={() => insert(snippet)}>
              {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
