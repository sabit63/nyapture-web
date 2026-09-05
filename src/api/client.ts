/**
 * Small, dependency-free HTTP client used by the browser UI.
 *
 * The client keeps its active settings in module state. Persistence, when
 * requested by the UI, is handled separately so this low-level module never
 * reads or writes browser storage implicitly.
 */

export const API_PROXY_PROTOCOLS = ['HTTP', 'HTTPS', 'SOCKS5'] as const

export type ApiProxyProtocol = typeof API_PROXY_PROTOCOLS[number]

export type ApiProxySettings = {
  enabled: boolean
  protocol: ApiProxyProtocol
  serverAddress: string
  port: number | null
}

export type ApiSettings = {
  apiUrl: string
  apiKey: string
  editKey: string
  timeoutSeconds: number
  proxy: ApiProxySettings
}

export type ApiSettingsInput = Omit<Partial<ApiSettings>, 'proxy'> & {
  proxy?: Partial<ApiProxySettings> | null
}

const defaultApiUrl = () => {
  const configuredUrl = import.meta.env?.VITE_NYA_API_URL?.trim()
  if (configuredUrl) return configuredUrl
  if (typeof window !== 'undefined') return window.location.origin
  return 'http://localhost:5270'
}

export const DEFAULT_API_SETTINGS: ApiSettings = {
  apiUrl: defaultApiUrl(),
  apiKey: import.meta.env?.VITE_NYA_API_KEY ?? '',
  editKey: import.meta.env?.VITE_NYA_EDIT_KEY ?? '',
  timeoutSeconds: 30,
  proxy: {
    enabled: false,
    protocol: 'HTTP',
    serverAddress: '',
    port: null,
  },
}

export type ApiSettingsErrors = {
  apiUrl?: string
  timeoutSeconds?: string
  proxyEnabled?: string
  proxyProtocol?: string
  proxyServerAddress?: string
  proxyPort?: string
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
  validationErrors?: string[]
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

const cloneApiSettings = (settings: ApiSettings): ApiSettings => ({
  ...settings,
  proxy: { ...settings.proxy },
})

let activeSettings: ApiSettings = cloneApiSettings(DEFAULT_API_SETTINGS)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const asNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
)

export const isApiProxyProtocol = (value: unknown): value is ApiProxyProtocol => (
  typeof value === 'string' && API_PROXY_PROTOCOLS.some((protocol) => protocol === value)
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
  settings: ApiSettingsInput = {},
  base: ApiSettings = activeSettings,
): ApiSettings => {
  const proxy = settings.proxy === null ? DEFAULT_API_SETTINGS.proxy : settings.proxy
  return {
    apiUrl: typeof settings.apiUrl === 'string' ? settings.apiUrl : base.apiUrl,
    apiKey: typeof settings.apiKey === 'string' ? settings.apiKey : base.apiKey,
    editKey: typeof settings.editKey === 'string' ? settings.editKey : base.editKey,
    timeoutSeconds: typeof settings.timeoutSeconds === 'number'
      ? settings.timeoutSeconds
      : base.timeoutSeconds,
    proxy: {
      enabled: typeof proxy?.enabled === 'boolean' ? proxy.enabled : base.proxy.enabled,
      protocol: proxy?.protocol ?? base.proxy.protocol,
      serverAddress: typeof proxy?.serverAddress === 'string' ? proxy.serverAddress : base.proxy.serverAddress,
      port: proxy?.port === null || typeof proxy?.port === 'number' ? proxy.port : base.proxy.port,
    },
  }
}

/** Validate settings while retaining secret values only in the returned settings object. */
export const validateApiSettings = (settings: ApiSettingsInput): ApiSettingsValidation => {
  const errors: ApiSettingsErrors = {}
  const apiUrl = normalizeApiUrl(settings.apiUrl ?? '')
  if (!apiUrl) errors.apiUrl = 'http:// または https:// で始まる有効なURLを入力してください。'

  const timeoutSeconds = settings.timeoutSeconds
  if (typeof timeoutSeconds !== 'number' || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
    errors.timeoutSeconds = 'タイムアウト秒数は1〜3600の整数で入力してください。'
  }

  const next = settingsFrom(settings)
  const proxyInput = settings.proxy as unknown
  if (proxyInput !== undefined && proxyInput !== null && (!isRecord(proxyInput)
    || ('enabled' in proxyInput && typeof proxyInput.enabled !== 'boolean'))) {
    errors.proxyEnabled = 'Proxy設定が無効です。'
  }

  const { enabled, protocol, port } = next.proxy
  const serverAddress = next.proxy.serverAddress.trim()
  if (enabled) {
    if (isRecord(proxyInput)) {
      if ('protocol' in proxyInput && !isApiProxyProtocol(proxyInput.protocol)) {
        errors.proxyProtocol = 'Protocolを選択してください。'
      }
      if ('serverAddress' in proxyInput && typeof proxyInput.serverAddress !== 'string') {
        errors.proxyServerAddress = 'Server Addressを入力してください。'
      }
      if ('port' in proxyInput && proxyInput.port !== null && typeof proxyInput.port !== 'number') {
        errors.proxyPort = 'Portは1〜65535の整数で入力してください。'
      }
    }
    if (!isApiProxyProtocol(protocol)) errors.proxyProtocol = 'Protocolを選択してください。'

    const hasServerAddress = serverAddress.length > 0
    const hasPort = port !== null
    if (!hasServerAddress) errors.proxyServerAddress = 'Server Addressを入力してください。'
    if (!hasPort) errors.proxyPort = 'Portを入力してください。'
    if (hasPort && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      errors.proxyPort = 'Portは1〜65535の整数で入力してください。'
    }
  }

  if (Object.keys(errors).length > 0) return { normalized: null, errors }
  return {
    normalized: {
      ...next,
      apiUrl: apiUrl ?? next.apiUrl,
      proxy: { ...next.proxy, serverAddress },
    },
    errors,
  }
}

/** Normalize settings, throwing a redacted validation error for invalid input. */
export const normalizeApiSettings = (settings: ApiSettingsInput = {}): ApiSettings => {
  const result = validateApiSettings(settingsFrom(settings))
  if (!result.normalized) {
    throw new ApiError('API設定が無効です。', { category: 'validation' })
  }
  return result.normalized
}

/** Configure the singleton client. Settings are kept in memory for this page only. */
export const configureApi = (settings: ApiSettingsInput): ApiSettings => {
  const next = normalizeApiSettings(settingsFrom(settings))
  activeSettings = cloneApiSettings(next)
  apiClient.configure(activeSettings)
  return cloneApiSettings(activeSettings)
}

export const configureApiSettings = configureApi

export const getApiSettings = (): ApiSettings => cloneApiSettings(activeSettings)

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
  readonly validationErrors?: string[]

  constructor(message: string, options: ApiErrorOptions = {}) {
    const category = options.category ?? (typeof options.status === 'number' ? categoryForStatus(options.status) : 'unknown')
    // Do not retain a caller/server-provided cause: it could contain a secret
    // value, and the public error contract only exposes status/category.
    super(redactSecrets(message))
    this.name = 'ApiError'
    this.status = options.status
    this.category = category
    this.validationErrors = options.validationErrors?.map(redactSecrets)
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

type RequestAbortSource = 'caller' | 'timeout'

const isAbortLike = (error: unknown) => (
  typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError'
    || isRecord(error) && error.name === 'AbortError'
)

const parseTextPayload = async (
  response: Response,
  isAborted: () => boolean = () => false,
): Promise<unknown> => {
  try {
    const text = await response.text()
    if (!text) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  } catch (error) {
    // A failed body read is normally kept tolerant for compatibility, but a
    // caller/timeout abort must reach the request-level classifier.
    if (isAborted()) throw error
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

/** A fetch wrapper with shared headers, query encoding, timeout, and redacted errors. */
export class ApiClient {
  private settings: ApiSettings

  constructor(settings: ApiSettingsInput = {}) {
    this.settings = normalizeApiSettings(settingsFrom(settings))
  }

  getSettings() {
    return cloneApiSettings(this.settings)
  }

  configure(settings: ApiSettingsInput) {
    this.settings = normalizeApiSettings(settingsFrom(settings, this.settings))
    return this.getSettings()
  }

  buildUrl(path: string, query?: ApiQuery) {
    return buildUrl(this.settings.apiUrl, path, query)
  }

  private async requestAndConsume<T>(
    path: string,
    options: ApiRequestOptions,
    consume: (response: Response, isAborted: () => boolean) => Promise<T>,
  ): Promise<T> {
    const timeoutSeconds = options.timeoutSeconds ?? this.settings.timeoutSeconds
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
      throw abortError('タイムアウト設定が無効です。', 'validation')
    }

    const controller = new AbortController()
    let abortSource: RequestAbortSource | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const callerSignal = options.signal
    if (callerSignal?.aborted) {
      throw abortError('リクエストがキャンセルされました。', 'unknown', callerSignal.reason)
    }
    let rejectAbort: ((reason?: unknown) => void) | undefined
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const abortWith = (source: RequestAbortSource, reason?: unknown) => {
      if (abortSource !== undefined) return
      abortSource = source
      controller.abort(reason)
      rejectAbort?.(reason ?? new Error('API request aborted'))
    }
    const onCallerAbort = () => abortWith('caller', callerSignal?.reason)

    try {
      callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
      // An abort can be requested between the initial check and listener
      // registration. Re-check so that this race is classified as caller-led.
      if (callerSignal?.aborted) {
        abortWith('caller', callerSignal.reason)
        throw abortError('リクエストがキャンセルされました。', 'unknown', callerSignal.reason)
      }

      timeoutId = setTimeout(() => abortWith('timeout'), timeoutSeconds * 1000)

      const headers = new Headers(options.headers)
      if (!headers.has('Accept')) headers.set('Accept', 'application/json')
      if (options.body !== undefined) headers.set('Content-Type', 'application/json')
      if (this.settings.apiKey) headers.set('X-API-Key', this.settings.apiKey)
      else headers.delete('X-API-Key')
      if (options.auth === 'edit' && this.settings.editKey) {
        headers.set('X-Edit-Api-Key', this.settings.editKey)
      } else headers.delete('X-Edit-Api-Key')

      const url = this.buildUrl(path, options.query)
      const body = options.body === undefined ? undefined : JSON.stringify(options.body)
      const response = await Promise.race([
        fetch(url, {
          method: options.method ?? 'GET',
          headers,
          body,
          signal: controller.signal,
        }),
        abortPromise,
      ])
      return await Promise.race([
        consume(response, () => abortSource !== undefined),
        abortPromise,
      ])
    } catch (error) {
      if (abortSource === 'timeout') {
        throw abortError('APIリクエストがタイムアウトしました。', 'timeout', error)
      }
      if (abortSource === 'caller') {
        throw abortError('リクエストがキャンセルされました。', 'unknown', error)
      }
      if (error instanceof ApiError) throw error
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
    return this.requestAndConsume(path, options, async (response, isAborted) => {
      const payload = await parseTextPayload(response, isAborted)
      if (!response.ok) {
        throw new ApiError(redactWithSettings(extractResponseMessage(payload, response), this.settings), {
          status: response.status,
          category: categoryForStatus(response.status),
          validationErrors: isRecord(payload) && isRecord(payload.data) && Array.isArray(payload.data.errors)
            ? payload.data.errors.filter((value): value is string => typeof value === 'string')
              .map((value) => redactWithSettings(value, this.settings))
            : undefined,
        })
      }
      return payload as T
    })
  }

  async requestText(path: string, options: ApiRequestOptions = {}): Promise<string> {
    return this.requestAndConsume(path, options, async (response, isAborted) => {
      const payload = await parseTextPayload(response, isAborted)
      if (!response.ok) {
        throw new ApiError(redactWithSettings(extractResponseMessage(payload, response), this.settings), {
          status: response.status,
          category: categoryForStatus(response.status),
        })
      }
      return typeof payload === 'string' ? payload : payload === undefined ? '' : JSON.stringify(payload)
    })
  }

  async requestBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
    return this.requestAndConsume(path, options, async (response, isAborted) => {
      if (!response.ok) {
        const payload = await parseTextPayload(response, isAborted)
        throw new ApiError(redactWithSettings(extractResponseMessage(payload, response), this.settings), {
          status: response.status,
          category: categoryForStatus(response.status),
        })
      }
      try {
        return await response.blob()
      } catch (error) {
        if (isAborted()) throw error
        throw abortError('API応答を読み込めませんでした。', 'unknown', error)
      }
    })
  }
}

export const apiClient = new ApiClient()
export const defaultApiClient = apiClient

export const requestJson = <T>(
  path: string,
  options?: ApiRequestOptions,
  settingsOverride?: ApiSettingsInput,
) => (settingsOverride ? new ApiClient(settingsOverride) : apiClient).requestJson<T>(path, options)

export const requestText = (
  path: string,
  options?: ApiRequestOptions,
  settingsOverride?: ApiSettingsInput,
) => (settingsOverride ? new ApiClient(settingsOverride) : apiClient).requestText(path, options)

export const requestBlob = (
  path: string,
  options?: ApiRequestOptions,
  settingsOverride?: ApiSettingsInput,
) => (settingsOverride ? new ApiClient(settingsOverride) : apiClient).requestBlob(path, options)

/** Check liveness with a temporary client when settings are supplied. */
export const testApiConnection = async (
  settings?: ApiSettingsInput,
  signal?: AbortSignal,
): Promise<string> => {
  const client = settings ? new ApiClient(settings) : apiClient
  return client.requestText('/alive', { headers: { Accept: 'text/plain' }, signal })
}

export const imageDescriptorToUrl = (
  descriptor: ApiImageRequestDescriptor,
  apiUrl = activeSettings.apiUrl,
) => buildUrl(normalizeApiUrl(apiUrl) ?? DEFAULT_API_SETTINGS.apiUrl, descriptor.path, descriptor.query)
