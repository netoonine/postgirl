import { useMemo } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { autocompletion, CompletionContext } from '@codemirror/autocomplete'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import { useStore } from '../store'

export type EditorLang = 'json' | 'javascript' | 'xml' | 'html' | 'text' | 'graphql'

// API pm.* mais usada, para autocompletar nos scripts
const PM_COMPLETIONS = [
  'pm.test("", function () {\n  \n});',
  'pm.expect()',
  'pm.response.json()',
  'pm.response.text()',
  'pm.response.code',
  'pm.response.status',
  'pm.response.headers.get("")',
  'pm.response.responseTime',
  'pm.response.to.have.status(200)',
  'pm.response.to.have.header("")',
  'pm.response.to.be.json',
  'pm.request.url.toString()',
  'pm.request.headers.add({ key: "", value: "" })',
  'pm.request.headers.upsert({ key: "", value: "" })',
  'pm.environment.get("")',
  'pm.environment.set("", )',
  'pm.environment.unset("")',
  'pm.collectionVariables.get("")',
  'pm.collectionVariables.set("", )',
  'pm.globals.get("")',
  'pm.globals.set("", )',
  'pm.variables.get("")',
  'pm.variables.set("", )',
  'pm.variables.replaceIn("")',
  'pm.iterationData.get("")',
  'pm.info.requestName',
  'pm.info.iteration',
  'pm.sendRequest("", function (err, res) {\n  \n});',
  'pm.visualizer.set(template, data)',
  'pm.execution.skipRequest()',
  'pm.execution.setNextRequest("")',
  'pm.cookies.get("")',
  'console.log()'
].map((label) => ({ label: label.split(/[(\n]/)[0], apply: label, type: 'function', detail: label.includes('(') ? '(…)' : '' }))

function pmComplete(ctx: CompletionContext) {
  const word = ctx.matchBefore(/(pm|console)[\w.]*/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  return { from: word.from, options: PM_COMPLETIONS, validFor: /^[\w.]*$/ }
}

export function CodeEditor({
  value,
  onChange,
  lang = 'text',
  readOnly,
  minHeight,
  placeholder,
  wrap = true
}: {
  value: string
  onChange?: (v: string) => void
  lang?: EditorLang
  readOnly?: boolean
  minHeight?: string
  placeholder?: string
  wrap?: boolean
}) {
  const theme = useStore((s) => s.settings.theme)
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)

  const extensions = useMemo(() => {
    const ext: any[] = []
    if (wrap) ext.push(EditorView.lineWrapping)
    if (lang === 'json') ext.push(json())
    if (lang === 'javascript') ext.push(javascript(), autocompletion({ override: [pmComplete] }))
    if (lang === 'xml') ext.push(xml())
    if (lang === 'html') ext.push(html())
    return ext
  }, [lang, wrap])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={dark ? githubDark : githubLight}
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      height="100%"
      minHeight={minHeight}
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: lang !== 'javascript', tabSize: 2 }}
    />
  )
}
