export const THUMBNAIL_MAX_AUTO_RETRIES = 2

const THUMBNAIL_RETRY_BASE_DELAY_MS = 500
const THUMBNAIL_RETRY_JITTER_MAX_MS = 250

export const normalizeThumbnailRetryNumber = (retryNumber: number) => {
  if (Number.isNaN(retryNumber)) return 1
  return Math.min(Math.max(Math.trunc(retryNumber), 1), THUMBNAIL_MAX_AUTO_RETRIES)
}

export const getThumbnailRetryDelayMs = (retryNumber: number, random = Math.random) => {
  const normalizedRetry = normalizeThumbnailRetryNumber(retryNumber)
  const baseDelay = THUMBNAIL_RETRY_BASE_DELAY_MS * 2 ** (normalizedRetry - 1)
  const randomValue = random()
  const normalizedRandom = Number.isNaN(randomValue)
    ? 0
    : Math.min(Math.max(randomValue, 0), 1)
  return baseDelay + Math.min(
    Math.floor(normalizedRandom * (THUMBNAIL_RETRY_JITTER_MAX_MS + 1)),
    THUMBNAIL_RETRY_JITTER_MAX_MS,
  )
}
