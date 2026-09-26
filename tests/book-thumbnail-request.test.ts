import assert from 'node:assert/strict'
import test from 'node:test'
import { createBookPageThumbnailRequest, mapEBookToCard } from '../src/api/books.ts'

test('standard thumbnail requests match viewer conversion settings', () => {
  assert.deepEqual(createBookPageThumbnailRequest('group', 'book', 1)?.query, {
    groupId: 'group', bookId: 'book', page: 1,
    width: 720, strategy: 'balanced', format: 'webp', fallback_to_original: false,
  })
})

test('library books with null page URLs retain their page count and thumbnail request', () => {
  const book = mapEBookToCard({ groupId: 'group', bookId: 'book', totalPage: 3, pageUrls: null })
  assert.deepEqual(book.pageUrls, [])
  assert.equal(book.totalPage, 3)
  assert.deepEqual(book.thumbnailRequest, createBookPageThumbnailRequest('group', 'book', 3))
})
