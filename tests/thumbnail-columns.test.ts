import assert from 'node:assert/strict'
import test from 'node:test'
import { automaticThumbnailColumns } from '../src/components/thumbnail-columns'
import { normalizeDisplaySettings } from '../src/api/display-settings-storage'

test('automatic columns follow available width and stay within one to ten columns', () => {
  assert.equal(automaticThumbnailColumns(160, 16), 1)
  assert.equal(automaticThumbnailColumns(576, 16), 2)
  assert.equal(automaticThumbnailColumns(1200, 16), 4)
  assert.equal(automaticThumbnailColumns(1600, 16), 6)
  assert.equal(automaticThumbnailColumns(2944, 16), 10)
  assert.equal(automaticThumbnailColumns(4000, 16), 10)
  // At small column counts the preferred ranges have gaps; from 1008px
  // onward the ranges overlap.
  for (let width = 1008; width <= 2944; width += 10) {
    const columns = automaticThumbnailColumns(width, 16)
    const cardWidth = (width - (columns - 1) * 16) / columns
    assert.ok(cardWidth >= 240 && cardWidth <= 320)
  }
})

test('automatic mode preserves manual columns and old settings remain manual', () => {
  assert.equal(normalizeDisplaySettings().autoThumbnailColumns, true)
  assert.equal(normalizeDisplaySettings({ thumbnailColumns: 7 }).autoThumbnailColumns, false)
  const saved = normalizeDisplaySettings({ thumbnailColumns: 7, autoThumbnailColumns: true })
  assert.deepEqual(normalizeDisplaySettings(JSON.parse(JSON.stringify(saved))), saved)
  assert.equal(normalizeDisplaySettings({ ...saved, autoThumbnailColumns: false }).thumbnailColumns, 7)
})
