import type { ConsoleEntry, EnvValue, TestResult } from '@shared/types'

export interface RunItemReport {
  iteration: number
  itemId: string
  name: string
  path: string
  method?: string
  url?: string
  code?: number
  status?: string
  time?: number
  size?: number
  tests: TestResult[]
  error?: string
}

export interface RunReport {
  collection: string
  environment?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  error?: string
  items: RunItemReport[]
  console: ConsoleEntry[]
  environmentOut?: EnvValue[]
}

export function summarize(r: RunReport) {
  const tests = r.items.flatMap((i) => i.tests)
  const failures: { where: string; message: string }[] = []
  for (const i of r.items) {
    const where = `${i.path}${r.items.some((x) => x.iteration > 0) ? ` (iteração ${i.iteration + 1})` : ''}`
    if (i.error) failures.push({ where, message: i.error })
    for (const t of i.tests) if (!t.passed && !t.skipped) failures.push({ where: `${where} › ${t.name}`, message: t.error || 'falhou' })
  }
  const timed = r.items.filter((i) => typeof i.time === 'number')
  return {
    requests: r.items.length,
    requestErrors: r.items.filter((i) => i.error).length,
    tests: tests.length,
    passed: tests.filter((t) => t.passed && !t.skipped).length,
    failed: tests.filter((t) => !t.passed && !t.skipped).length,
    skipped: tests.filter((t) => t.skipped).length,
    avgResponseMs: timed.length ? timed.reduce((a, i) => a + (i.time || 0), 0) / timed.length : 0,
    failures
  }
}

const xml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** JUnit XML: uma testsuite por requisição (e iteração), um testcase por teste. Lido por GitHub, GitLab, Jenkins. */
export function junitReport(r: RunReport): string {
  const s = summarize(r)
  const suites = r.items.map((i) => {
    const name = `${i.path}${r.items.some((x) => x.iteration > 0) ? ` [${i.iteration + 1}]` : ''}`
    const cases = i.tests.map((t) => {
      const body = t.skipped
        ? '<skipped/>'
        : t.passed
          ? ''
          : `<failure type="AssertionFailure" message="${xml(t.error || 'falhou')}">${xml(t.error || '')}</failure>`
      return `      <testcase name="${xml(t.name)}" classname="${xml(name)}" time="0">${body}</testcase>`
    })
    if (i.error)
      cases.push(`      <testcase name="requisição" classname="${xml(name)}" time="${(i.time || 0) / 1000}"><error message="${xml(i.error)}"/></testcase>`)
    const failures = i.tests.filter((t) => !t.passed && !t.skipped).length
    return [
      `    <testsuite name="${xml(name)}" tests="${cases.length}" failures="${failures}" errors="${i.error ? 1 : 0}" skipped="${i.tests.filter((t) => t.skipped).length}" time="${(i.time || 0) / 1000}" timestamp="${xml(r.startedAt)}">`,
      ...cases,
      '    </testsuite>'
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(r.collection)}" tests="${s.tests + s.requestErrors}" failures="${s.failed}" errors="${s.requestErrors}" time="${(r.durationMs || 0) / 1000}">`,
    ...suites,
    '</testsuites>',
    ''
  ].join('\n')
}
