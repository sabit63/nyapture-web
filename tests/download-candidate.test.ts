import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapWebCacheBookToCard } from '../src/api/books'
import { isDownloadCandidate } from '../src/features/search/download-candidate'

describe('download candidate predicate', () => {
  it('matches only web books with a used artist or group tag', () => {
    const base = {
      status: 'WebBookInPage' as const,
      tags: [{ type: 'Artists' as const, name: 'artist', count: 1 }],
    }
    assert.equal(isDownloadCandidate(base), true)
    assert.equal(isDownloadCandidate({ ...base, status: 'WebBook' }), true)
    assert.equal(isDownloadCandidate({ ...base, tags: [{ type: 'Groups', name: 'group', count: 2 }] }), true)
    assert.equal(isDownloadCandidate({ ...base, tags: [{ type: 'Artists', name: 'artist', count: 0 }] }), false)
    assert.equal(isDownloadCandidate({ ...base, tags: [{ type: 'Artists', name: 'artist' }] }), false)
    assert.equal(isDownloadCandidate({ ...base, tags: [{ type: 'Tags', name: 'tag', count: 4 }] }), false)
    assert.equal(isDownloadCandidate({ ...base, status: 'Downloaded' }), false)
  })
})

describe('Web Cache response tag mapping', () => {
  it('uses response counts and approved names without replacing canonical names', () => {
    const card = mapWebCacheBookToCard({
      tagSet: { Artists: ['artist'], Groups: ['artist'], Tags: ['tag'] },
      tags: [
        { type: 'Artists', name: 'artist', count: 2, displayName: '作家名' },
        { type: 'Groups', name: 'artist', count: 0 },
        { type: 'Tags', name: 'tag', count: 7, displayName: 'タグ名' },
      ],
    })
    assert.deepEqual(card.tags, [
      { type: 'Artists', name: 'artist', count: 2, displayName: '作家名' },
      { type: 'Groups', name: 'artist', count: 0, displayName: undefined },
      { type: 'Tags', name: 'tag', count: 7, displayName: 'タグ名' },
    ])
    assert.equal(isDownloadCandidate(card), true)
  })

  it('keeps unenriched tagSet entries and does not highlight absent or zero counts', () => {
    for (const tags of [undefined, [], [{ type: 'Artists' as const, name: 'artist', count: 0 }]]) {
      const card = mapWebCacheBookToCard({ tagSet: { Artists: ['artist'] }, tags })
      assert.equal(card.tags[0].name, 'artist')
      assert.equal(isDownloadCandidate(card), false)
    }
  })

  it('supports tags without tagSet and ignores incomplete entities', () => {
    const card = mapWebCacheBookToCard({ tags: [
      { type: 'Groups', name: 'group', count: 1, displayName: 'サークル' },
      { type: 'Artists' },
      { name: 'missing-type' },
    ] })
    assert.deepEqual(card.tags, [{ type: 'Groups', name: 'group', count: 1, displayName: 'サークル' }])
    assert.equal(isDownloadCandidate(card), true)
  })
})
