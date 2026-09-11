import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import tailwindcss from '@tailwindcss/vite'
import { build } from 'vite'

test('motion utilities resolve across feature CSS without duplicate keyframes', async () => {
  const input = readdirSync('src', { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.css'))
    .map(file => resolve('src', file))
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [tailwindcss()],
    build: { write: false, minify: false, cssMinify: false, rollupOptions: { input } },
  })
  assert.ok(!Array.isArray(result) && 'output' in result)
  const css = result.output.flatMap(item => item.type === 'asset' && item.fileName.endsWith('.css')
    ? [typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString()]
    : []).join('\n')
  const definitions = new Map([...css.matchAll(/--tw-animate-([\w-]+):\s*([^;]+);/g)]
    .map(match => [match[1], match[2]]))
  const keyframes = [...css.matchAll(/@keyframes\s+(nya-[\w-]+)/g)].map(match => match[1])
  assert.ok(keyframes.length > 0)
  assert.equal(new Set(keyframes).size, keyframes.length, 'keyframes must be emitted only once')

  const usages = [...css.matchAll(/animation:\s*var\(--tw-animate-([\w-]+)\)/g)]
  assert.ok(usages.length > 0)
  for (const [, name] of usages) {
    const value = definitions.get(name)
    assert.ok(value, `missing animation token: ${name}`)
    assert.ok(keyframes.includes(value.split(/\s+/)[0]), `missing keyframes: ${name}`)
  }
  for (const [name, duration] of [['spin', .85], ['spin-fast', .8], ['spin-slow', 1.35]] as const) {
    assert.equal(parseFloat(definitions.get(name)!.split(/\s+/)[1]), duration)
  }
  const spinner = css.match(/\.book-status-spinner\s*\{([^}]+)\}/)?.[1]
  assert.ok(spinner)
  assert.doesNotMatch(spinner, /animation[^;]*!important/, 'spinner must respect reduced motion')
  assert.match(css, /animation-iteration-count:\s*1\s*!important/)
})
