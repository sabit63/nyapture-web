import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookPageThumbnailRequest } from '../src/api/books.ts'

test('standard thumbnail requests match viewer conversion settings', () => {
  assert.deepEqual(createBookPageThumbnailRequest('group', 'book', 1)?.query, {
    groupId: 'group', bookId: 'book', page: 1,
    width: 720, strategy: 'balanced', format: 'webp', fallback_to_original: false,
  })
})
