import assert from 'node:assert/strict'
import { it } from 'node:test'
import { buildHitomiSearchUrl } from '../src/api/hitomi'

it('Hitomi Append affects only Tags in a mixed-tag search', () => {
  const tags = [
    { type: 'Artists', name: 'artist name' },
    { type: 'Groups', name: 'group name' },
    { type: 'Parodies', name: 'series' },
    { type: 'Characters', name: 'character' },
    { type: 'Categories', name: 'doujinshi' },
    { type: 'Languages', name: 'japanese' },
    { type: 'Unknown', name: 'unknown' },
    { type: 'Tags', name: 'example' },
  ] as const

  for (const append of ['Normal', 'Male', 'Female'] as const) {
    const url = new URL(buildHitomiSearchUrl({ text: '', tags: [...tags] }, append))
    const field = append === 'Normal' ? 'tag' : append.toLowerCase()
    assert.equal(
      decodeURIComponent(url.search.slice(1)),
      `artist:artist_name group:group_name series:series character:character type:doujinshi language:japanese tag:unknown ${field}:example`,
      append,
    )
  }
})
