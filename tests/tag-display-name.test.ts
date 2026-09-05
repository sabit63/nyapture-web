import assert from 'node:assert/strict'
import test from 'node:test'

import type { BookTag, TagEntity } from '../src/models'
import {
  applyTagEntityMetadata,
  applyTagDisplayNameOverrides,
  getTagDisplayNameKey,
  updateTagDisplayNames,
} from '../src/features/search/tag-display-name'

const target: BookTag = { type: 'Artists', name: 'Artist Name' }

test('updates matching BookTags without changing their canonical names', () => {
  const tags: BookTag[] = [
    { type: 'Artists', name: 'artist name' },
    { type: 'Tags', name: 'artist name' },
  ]

  const updated = updateTagDisplayNames(tags, target, '作家名')

  assert.deepEqual(updated, [
    { type: 'Artists', name: 'artist name', displayName: '作家名' },
    { type: 'Tags', name: 'artist name' },
  ])
  assert.equal(updated[0].name, tags[0].name)
  assert.notEqual(updated, tags)
  assert.notEqual(updated[0], tags[0])
  assert.equal(updated[1], tags[1])
})

test('removes a pending display-name override from BookTags and entities', () => {
  const tags: BookTag[] = [{ ...target, displayName: '以前の表示名' }]
  const entities: TagEntity[] = [{ type: target.type, name: target.name, displayName: '以前の表示名', count: 3 }]

  assert.deepEqual(updateTagDisplayNames(tags, target), [target])
  assert.deepEqual(updateTagDisplayNames(entities, target), [{ type: target.type, name: target.name, count: 3 }])
})

test('applies immutable overrides and supports explicit removal', () => {
  const source: BookTag[] = [
    { ...target, displayName: 'サーバー表示名' },
    { type: 'Groups', name: target.name, displayName: '別の表示名' },
  ]
  const overrides = new Map([[getTagDisplayNameKey(target), undefined]])

  const result = applyTagDisplayNameOverrides(source, overrides)

  assert.deepEqual(result, [
    target,
    source[1],
  ])
  assert.notEqual(result, source)
  assert.notEqual(result[0], source[0])
  assert.equal(result[1], source[1])
})

test('applies response entity display names and counts to search criteria tags', () => {
  const tags: BookTag[] = [
    target,
    { type: 'Groups', name: 'Circle Name', displayName: '既存の表示名' },
  ]
  const entities: TagEntity[] = [
    { type: 'Artists', name: 'artist name', displayName: ' 作家名 ', count: 3 },
    { type: 'Groups', name: 'Circle Name', count: 0 },
  ]

  const result = applyTagEntityMetadata(tags, entities)

  assert.deepEqual(result, [
    { ...target, displayName: '作家名', count: 3 },
    { ...tags[1], count: 0 },
  ])
  assert.notEqual(result, tags)
  assert.notEqual(result[1], tags[1])
})
