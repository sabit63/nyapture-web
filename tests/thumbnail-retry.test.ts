import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getThumbnailRetryDelayMs,
  normalizeThumbnailRetryNumber,
} from '../src/components/thumbnail-retry.ts'

test('thumbnail retry delays use the two exponential steps and bounded jitter', () => {
  assert.equal(getThumbnailRetryDelayMs(1, () => 0), 500)
  assert.equal(getThumbnailRetryDelayMs(1, () => 1), 750)
  assert.equal(getThumbnailRetryDelayMs(2, () => 0), 1000)
  assert.equal(getThumbnailRetryDelayMs(2, () => 1), 1250)
  assert.equal(getThumbnailRetryDelayMs(2, () => 0.5), 1125)
})

test('thumbnail retry timing normalizes retry and random boundaries', () => {
  assert.equal(normalizeThumbnailRetryNumber(-10), 1)
  assert.equal(normalizeThumbnailRetryNumber(1.9), 1)
  assert.equal(normalizeThumbnailRetryNumber(99), 2)
  assert.equal(normalizeThumbnailRetryNumber(Number.NaN), 1)

  assert.equal(getThumbnailRetryDelayMs(1, () => -1), 500)
  assert.equal(getThumbnailRetryDelayMs(1, () => 2), 750)
  assert.equal(getThumbnailRetryDelayMs(1, () => Number.NaN), 500)
})
