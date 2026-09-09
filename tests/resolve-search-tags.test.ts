import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { resolveSearchTags } from '../src/features/search/resolve-search-tags'
import { applyTagEntityMetadata } from '../src/features/search/tag-display-name'
import type { BookTag } from '../src/models'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const tag: BookTag = { type: 'Languages', name: 'japanese' }

test('restores approved display names for URL tags missing from Hitomi metadata', async () => {
  let calls = 0
  globalThis.fetch = async (input) => {
    calls++
    assert.match(String(input), /\/api\/tag-additional\/Languages\/japanese$/)
    return Response.json({ primaryAdditionalName: '日本語', status: 'Approved' })
  }
  const entities = await resolveSearchTags([tag, tag], [{ ...tag, count: 12 }], new AbortController().signal)
  assert.equal(calls, 1)
  assert.deepEqual(applyTagEntityMetadata([tag], entities), [{ ...tag, count: 12, displayName: '日本語' }])
})

test('keeps existing response labels without additional requests', async () => {
  globalThis.fetch = async () => { throw new Error('unexpected request') }
  const entities = [{ ...tag, displayName: '日本語' }]
  assert.deepEqual(await resolveSearchTags([tag], entities, new AbortController().signal), entities)
})

test('missing and pending labels leave canonical names usable', async () => {
  for (const status of ['Pending', 'missing']) {
    globalThis.fetch = async () => status === 'missing'
      ? Response.json({}, { status: 404 })
      : Response.json({ primaryAdditionalName: '未承認', status })
    assert.deepEqual(await resolveSearchTags([tag], [], new AbortController().signal), [])
  }
})

test('ignores labels returned after cancellation', async () => {
  const controller = new AbortController()
  globalThis.fetch = async () => {
    controller.abort()
    return Response.json({ primaryAdditionalName: '日本語', status: 'Approved' })
  }
  assert.deepEqual(await resolveSearchTags([tag], [], controller.signal), [])
})
