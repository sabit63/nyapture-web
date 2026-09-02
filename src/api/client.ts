/**
 * Small, dependency-free HTTP client used by the browser UI.
 *
 * The client keeps its active settings in module state. Persistence, when
 * requested by the UI, is handled separately so this low-level module never
 * reads or writes browser storage implicitly.
 */

export const DEFAULT_API_SETTINGS = {
  apiUrl: 'http://localhost:5270',
  apiKey: '',
  editKey: '',
  timeoutSeconds: 30,
} as const

export type ApiSettings = {
  apiUrl: string
  apiKey: string
  editKey: string
  timeoutSeconds: number
}

export type ApiSettingsErrors = {
  apiUrl?: string
  timeoutSeconds?: string
}

export type ApiSettingsValidation = {
  normalized: ApiSettings | null
  errors: ApiSettingsErrors
}

export type ApiErrorCategory =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'timeout'
  | 'offline'
  | 'server'
  | 'unknown'

export type ApiErrorOptions = {
  status?: number
  category?: ApiErrorCategory
  cause?: unknown
}

const ERROR_MESSAGES: Record<ApiErrorCategory, string> = {
  validation: '入力内容を確認してください。',
  unauthorized: 'APIキーが正しくありません。',
  forbidden: 'この操作を実行する権限がありません。',
  notFound: '指定したデータが見つかりません。',
  conflict: '操作が競合したため完了できませんでした。',
  timeout: 'APIへの接続がタイムアウトしました。',
  offline: 'APIに接続できません。ネットワークを確認してください。',
  server: 'APIサーバーでエラーが発生しました。',
  unknown: 'APIリクエストに失敗しました。',
}

let activeSettings: ApiSettings = { ...DEFAULT_API_SETTINGS }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const asNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
)

/** Normalize and validate an API base URL without retaining query/hash data. */
export const normalizeApiUrl = (value: string): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null

    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.origin}${path}`
  } catch {
    return null
  }
}

const settingsFrom = (
  settings: Partial<ApiSettings> = {},
  base: ApiSettings = activeSettings,
): ApiSettings => ({
  apiUrl: typeof settings.apiUrl === 'string' ? settings.apiUrl : base.apiUrl,
  apiKey: typeof settings.apiKey === 'string' ? settings.apiKey : base.apiKey,
  editKey: typeof settings.editKey === 'string' ? settings.editKey : base.editKey,
  timeoutSeconds: typeof settings.timeoutSeconds === 'number'
    ? settings.timeoutSeconds
    : base.timeoutSeconds,
})

/** Validate settings while retaining secret values only in the returned settings object. */
export const validateApiSettings = (settings: Partial<ApiSettings>): ApiSettingsValidation => {
  const errors: ApiSettingsErrors = {}
  const apiUrl = normalizeApiUrl(settings.apiUrl ?? '')
  if (!apiUrl) errors.apiUrl = 'http:// または https:// で始まる有効なURLを入力してください。'

  const timeoutSeconds = settings.timeoutSeconds
  if (typeof timeoutSeconds !== 'number' || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
    errors.timeoutSeconds = 'タイムアウト秒数は1〜3600の整数で入力してください。'
  }

  if (Object.keys(errors).length > 0) return { normalized: null, errors }
  const next = settingsFrom({ ...settings, apiUrl: apiUrl ?? undefined })
  return { normalized: next, errors }
}

/** Normalize settings, throwing a redacted validation error for invalid input. */
export const normalizeApiSettings = (settings: Partial<ApiSettings> = {}): ApiSettings => {
  const result = validateApiSettings(settingsFrom(settings))
  if (!result.normalized) {
    throw new ApiError('API設定が無効です。', { category: 'validation' })
  }
  return result.normalized
}

/** Configure the singleton client. Settings are kept in memory for this page only. */
export const configureApi = (settings: Partial<ApiSettings>): ApiSettings => {
  const next = normalizeApiSettings(settingsFrom(settings))
  activeSettings = next
  apiClient.configure(activeSettings)
  return { ...activeSettings }
}

export const configureApiSettings = configureApi

export const getApiSettings = (): ApiSettings => ({ ...activeSettings })

const redactSecrets = (value: string): string => {
  let redacted = value
  for (const secret of [activeSettings.apiKey, activeSettings.editKey]) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

const redactWithSettings = (value: string, settings: ApiSettings): string => {
  let redacted = value
  for (const secret of [settings.apiKey, settings.editKey]) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

const categoryForStatus = (status: number): ApiErrorCategory => {
  if (status === 400 || status === 422) return 'validation'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'server'
  return 'unknown'
}

const categoryForError = (error: unknown): ApiErrorCategory => {
  if (error instanceof ApiError) return error.category
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (error instanceof TypeError) return 'offline'
  return 'unknown'
}

export class ApiError extends Error {
  readonly status?: number
  readonly category: ApiErrorCategory

  constructor(message: string, options: ApiErrorOptions = {}) {
    const category = options.category ?? (typeof options.status === 'number' ? categoryForStatus(options.status) : 'unknown')
    // Do not retain a caller/server-provided cause: it could contain a secret
    // value, and the public error contract only exposes status/category.
    super(redactSecrets(message))
    this.name = 'ApiError'
    this.status = options.status
    this.category = category
  }

  toUserMessage() {
    return ERROR_MESSAGES[this.category]
  }
}

export const getErrorMessage = (error: unknown): string => (
  error instanceof ApiError ? error.toUserMessage() : ERROR_MESSAGES.unknown
)

export const getApiErrorMessage = getErrorMessage
export const getApiErrorUserMessage = getErrorMessage

export type ApiQueryValue = string | number | boolean | null | undefined
export type ApiQuery = Record<string, ApiQueryValue | readonly ApiQueryValue[]>

export type ApiRequestOptions = {
  method?: string
  query?: ApiQuery
  body?: unknown
  signal?: AbortSignal
  timeoutSeconds?: number
  auth?: 'read' | 'edit'
  headers?: HeadersInit
}

export type ApiImageRequestDescriptor = {
  method: 'GET'
  path: string
  query: Record<string, string | number | boolean>
}

const appendQuery = (url: URL, query?: ApiQuery) => {
  if (!query) return
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== null && item !== undefined) url.searchParams.append(key, String(item))
      })
      return
    }
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
  })
}

const buildUrl = (baseUrl: string, path: string, query?: ApiQuery): string => {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new ApiError('APIパスが無効です。', { category: 'validation' })
  }

  const url = new URL(`${baseUrl}${path}`)
  appendQuery(url, query)
  return url.toString()
}

const parseTextPayload = async (response: Response): Promise<unknown> => {
  try {
    const text = await response.text()
    if (!text) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  } catch {
    return undefined
  }
}

const extractResponseMessage = (payload: unknown, response: Response): string => {
  if (isRecord(payload)) {
    const message = asNonEmptyString(payload.message) ?? asNonEmptyString(payload.error)
    if (message) return message
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim()
  return response.statusText || `HTTP ${response.status}`
}

const abortError = (message: string, category: ApiErrorCategory, cause?: unknown) => (
  new ApiError(message, { category, cause })
)

const isAbortLike = (error: unknown) => (
  typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError'
    || isRecord(error) && error.name === 'AbortError'
)

/** A fetch wrapper with shared headers, query encoding, timeout, and redacted errors. */
export class ApiClient {
  private settings: ApiSettings

  constructor(settings: Partial<ApiSettings> = {}) {
    this.settings = normalizeApiSettings(settingsFrom(settings))
  }

  getSettings() {
    return { ...this.settings }
  }

  configure(settings: Partial<ApiSettings>) {
    this.settings = normalizeApiSettings(settingsFrom(settings, this.settings))
    return this.getSettings()
  }

  buildUrl(path: string, query?: ApiQuery) {
    return buildUrl(this.settings.apiUrl, path, query)
  }

  private async request(path: string, options: ApiRequestOptions = {}): Promise<Response> {
    const timeoutSeconds = options.timeoutSeconds ?? this.settings.timeoutSeconds
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
      throw abortError('タイムアウト設定が無効です。', 'validation')
    }

    const controller = new AbortController()
    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const callerSignal = options.signal
    const onCallerAbort = () => controller.abort(callerSignal?.reason)

    if (callerSignal?.aborted) {
      throw abortError('リクエストがキャンセルされました。', 'unknown', callerSignal.reason)
    }
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutSeconds * 1000)

    const headers = new Headers(options.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')
    if (this.settings.apiKey) headers.set('X-API-Key', this.settings.apiKey)
    else headers.delete('X-API-Key')
    if (options.auth === 'edit' && this.settings.editKey) {
      headers.set('X-Edit-Api-Key', this.settings.editKey)
    } else headers.delete('X-Edit-Api-Key')

    try {
      const url = this.buildUrl(path, options.query)
      const body = options.body === undefined ? undefined : JSON.stringify(options.body)
      return await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (timedOut) throw abortError('APIリクエストがタイムアウトしました。', 'timeout', error)
      if (isAbortLike(error) || callerSignal?.aborted) {
        throw abortError('リクエストがキャンセルされました。', 'unknown', error)
      }
      throw abortError('APIに接続できません。', categoryForError(error), error)
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }

  async requestJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const response = await this.request(path, options)
    const payload = await parseTextPayload(response)
    if (!response.ok) {
      throw new ApiError(redactWithSettings(extractResponseMessage(payload, response), this.settings), {
        status: response.status,
        category: categoryForStatus(response.status),
      })
    }
    return payload as T
  }

  async requestText(path: string, options: ApiRequestOptions = {}): Promise<string> {
    const response = await this.request(path, options)
    const payload = await parseTextPayload(response)
    if (!response.ok) {
      throw new ApiError(redactWithSettings(extractResponseMessage(payload, response), this.settings), {
        status: response.status,
        category: categoryForStatus(response.status),
      })
    }
    return typeof payload === 'string' ? payload : payload === undefined ? '' : JSON.stringify(payload)
  }

  async requestBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
    const response = await this.request(path, options)
    if (!response.ok) {
      const payload = await parseTextPayload(response)
      throw new ApiError(redactWithSettings(extractResponseMessage(payload, response), this.settings), {
        status: response.status,
        category: categoryForStatus(response.status),
      })
    }
    try {
      return await response.blob()
    } catch (error) {
      throw abortError('API応答を読み込めませんでした。', 'unknown', error)
    }
  }
}

export const apiClient = new ApiClient()
export const defaultApiClient = apiClient

export const requestJson = <T>(
  path: string,
  options?: ApiRequestOptions,
  settingsOverride?: Partial<ApiSettings>,
) => (settingsOverride ? new ApiClient(settingsOverride) : apiClient).requestJson<T>(path, options)

export const requestText = (
  path: string,
  options?: ApiRequestOptions,
  settingsOverride?: Partial<ApiSettings>,
) => (settingsOverride ? new ApiClient(settingsOverride) : apiClient).requestText(path, options)

export const requestBlob = (
  path: string,
  options?: ApiRequestOptions,
  settingsOverride?: Partial<ApiSettings>,
) => (settingsOverride ? new ApiClient(settingsOverride) : apiClient).requestBlob(path, options)

/** Check liveness with a temporary client when settings are supplied. */
export const testApiConnection = async (
  settings?: Partial<ApiSettings>,
  signal?: AbortSignal,
): Promise<string> => {
  const client = settings ? new ApiClient(settings) : apiClient
  return client.requestText('/alive', { headers: { Accept: 'text/plain' }, signal })
}

export const imageDescriptorToUrl = (
  descriptor: ApiImageRequestDescriptor,
  apiUrl = activeSettings.apiUrl,
) => buildUrl(normalizeApiUrl(apiUrl) ?? DEFAULT_API_SETTINGS.apiUrl, descriptor.path, descriptor.query)
