import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findSearchBookIndex,
  replaceSearchBookByIdentity,
  type SearchBookIdentity,
} from '../src/features/search/search-book-download'

const original: SearchBookIdentity = {
  groupId: 'hitomi',
  bookId: 'https://hitomi.la/galleries/example.html',
  url: 'https://hitomi.la/galleries/example.html',
}

const refreshed: SearchBookIdentity = {
  groupId: 'group-1',
  bookId: 'book-1',
  url: original.url,
}

test('a detail refresh can replace a candidate whose server identity is filled in', () => {
  const books = [original, {
    groupId: 'group-2',
    bookId: 'book-2',
    url: 'https://hitomi.la/galleries/other.html',
  }]

  const next = replaceSearchBookByIdentity(books, original, refreshed)

  assert.deepEqual(next[0], refreshed)
  assert.deepEqual(next[1], books[1])
})

test('the refreshed identity remains matchable after the card has been replaced', () => {
  assert.equal(findSearchBookIndex([refreshed], original, refreshed), 0)
})

test('an unambiguous URL is a safe fallback when identities differ', () => {
  const current = [{
    groupId: 'server-group',
    bookId: 'server-book',
    url: original.url,
  }, {
    groupId: 'other-group',
    bookId: 'other-book',
    url: 'https://hitomi.la/galleries/other.html',
  }]

  assert.equal(findSearchBookIndex(current, {
    groupId: 'placeholder-group',
    bookId: 'placeholder-book',
    url: original.url,
  }), 0)
})

test('duplicate URLs are not used to guess a replacement card', () => {
  const duplicateUrl = original.url
  const current = [
    { groupId: 'server-group-1', bookId: 'server-book-1', url: duplicateUrl },
    { groupId: 'server-group-2', bookId: 'server-book-2', url: duplicateUrl },
  ]

  assert.equal(findSearchBookIndex(current, {
    groupId: 'placeholder-group',
    bookId: 'placeholder-book',
    url: duplicateUrl,
  }), -1)
})
