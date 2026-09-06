import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { configureApi, getApiSettings } from '../src/api/client'
import { mapEBookToCard } from '../src/api/books'
import { useBookTagEditor } from '../src/features/viewer/use-book-tag-editor'
import { act, deferred, installHookDom, renderHook } from './helpers/react-hook'

const originalSettings = getApiSettings()
let dom: ReturnType<typeof installHookDom>
beforeEach(() => {
  dom = installHookDom()
  configureApi({ ...originalSettings, editKey: 'fixture-edit' })
})
afterEach(() => { configureApi(originalSettings); dom.cleanup() })
const book = mapEBookToCard({ groupId: 'g', bookId: 'b', tagSet: { Tags: ['old'] } })
const reply = (tagNames: string[]) => new Response(JSON.stringify({ success: true, books: [{ groupId: 'g', bookId: 'b', tagSet: { Tags: tagNames } }] }))

describe('book tag editor state', () => {
  it('keeps changes local and discards drafts on cancel', async () => {
    const hook = await renderHook(() => useBookTagEditor(book, () => assert.fail('unexpected update')), {})
    try {
      await act(async () => { hook.current.begin() })
      await act(async () => { hook.current.add({ type: 'Tags', name: ' new ' }); hook.current.add({ type: 'Tags', name: 'old' }) })
      assert.deepEqual(hook.current.draft.map((tag) => tag.name), ['old', 'new'])
      assert.equal(hook.current.dirty, true)
      await act(async () => { hook.current.finish() })
      assert.equal(hook.current.editing, false)
      await act(async () => { hook.current.begin() })
      assert.deepEqual(hook.current.draft, book.tags)
      assert.equal(hook.current.dirty, false)
      await act(async () => { hook.current.openAdd('Artists'); hook.current.setInput('typing') })
      assert.equal(hook.current.hasUnsavedChanges, true)
    } finally { await hook.unmount() }
  })

  it('blocks duplicate saves and cancellation while saving, then publishes server tags', async () => {
    const mutation = deferred<Response>()
    const methods: string[] = []
    globalThis.fetch = (async (_url, init) => {
      methods.push(init?.method ?? 'GET')
      return init?.method === 'POST' ? mutation.promise : reply(['old', 'new'])
    }) as typeof fetch
    const changes: string[][] = []
    const hook = await renderHook(() => useBookTagEditor(book, (updated) => changes.push(updated.tags.map((tag) => tag.name))), {})
    try {
      await act(async () => { hook.current.begin() })
      await act(async () => { hook.current.add({ type: 'Tags', name: 'new' }) })
      let saving!: Promise<void>
      await act(async () => { saving = hook.current.save() })
      assert.equal(hook.current.pending, true)
      await act(async () => { hook.current.finish(); await hook.current.save() })
      assert.equal(hook.current.editing, true)
      assert.deepEqual(methods, ['POST'])
      await act(async () => { mutation.resolve(new Response('{"success":true}')); await saving })
      assert.equal(hook.current.editing, false)
      assert.equal(hook.current.pending, false)
      assert.deepEqual(changes, [['old', 'new']])
    } finally { await hook.unmount() }
  })

  it('retains the draft after partial success and retries only the remaining removal', async () => {
    let stored = ['old']
    let failRemoval = true
    const mutations: string[] = []
    globalThis.fetch = (async (_url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') return reply(stored)
      mutations.push(method)
      if (method === 'POST') stored.push('new')
      if (method === 'DELETE') {
        if (failRemoval) { failRemoval = false; return new Response('{"success":false}', { status: 503 }) }
        stored = stored.filter((name) => name !== 'old')
      }
      return new Response('{"success":true}')
    }) as typeof fetch
    const updates: string[][] = []
    const hook = await renderHook(() => useBookTagEditor(book, (updated) => updates.push(updated.tags.map((tag) => tag.name))), {})
    try {
      await act(async () => { hook.current.begin() })
      await act(async () => { hook.current.remove(book.tags[0]); hook.current.add({ type: 'Tags', name: 'new' }) })
      await act(async () => { await hook.current.save() })
      assert.equal(hook.current.editing, true)
      assert.equal(hook.current.needsRefresh, false)
      assert.deepEqual(hook.current.draft.map((tag) => tag.name), ['new'])
      assert.deepEqual(updates, [['old', 'new']])
      await act(async () => { await hook.current.save() })
      assert.deepEqual(mutations, ['POST', 'DELETE', 'DELETE'])
      assert.deepEqual(updates, [['old', 'new'], ['new']])
      assert.equal(hook.current.editing, false)
    } finally { await hook.unmount() }
  })

  it('requires a successful state read after ambiguous failure even across cancel and reopen', async () => {
    let readsFail = true
    let mutations = 0
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === 'POST') { mutations += 1; throw new Error('connection lost') }
      if (readsFail) throw new Error('offline')
      return reply(['old', 'new'])
    }) as typeof fetch
    const hook = await renderHook(() => useBookTagEditor(book, () => {}), {})
    try {
      await act(async () => { hook.current.begin() })
      await act(async () => { hook.current.add({ type: 'Tags', name: 'new' }) })
      await act(async () => { await hook.current.save() })
      assert.equal(hook.current.needsRefresh, true)
      assert.deepEqual(hook.current.draft.map((tag) => tag.name), ['old', 'new'])
      await act(async () => { hook.current.finish() })
      await act(async () => { hook.current.begin() })
      assert.equal(hook.current.needsRefresh, true)
      await act(async () => { await hook.current.save() })
      assert.equal(mutations, 1)
      readsFail = false
      await act(async () => { await hook.current.save() })
      assert.equal(hook.current.needsRefresh, false)
      assert.equal(hook.current.editing, true)
      assert.equal(mutations, 1)
    } finally { await hook.unmount() }
  })
})
