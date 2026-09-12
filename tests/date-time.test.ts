import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { formatDateTime } from '../src/models/date-time'

test('JST display is identical across host timezones, including legacy UTC timestamps', () => {
  const values = [
    '2026-12-31T15:04:05Z',
    '2027-01-01T00:04:05+09:00',
    '2026-12-31T07:04:05-08:00',
    '2026-12-31T15:04:05',
    '2026-12-31 15:04:05.1234567',
  ]
  const script = `import { formatDateTime } from './src/models/date-time.ts';
    console.log(JSON.stringify(${JSON.stringify(values)}.map(formatDateTime)))`
  for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    })
    assert.deepEqual(JSON.parse(output), values.map(() => '2027/01/01 00:04:05 JST'), timezone)
  }
  for (const value of [null, undefined, '', ' ', 'invalid', '09/12/2026 12:00', '2026-13-12T12:00:00']) assert.equal(formatDateTime(value), '—')
  assert.equal(formatDateTime('2026-09-12'), '2026/09/12 09:00:00 JST')
})
