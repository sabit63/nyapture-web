export {
  ApiClient,
  ApiError,
  apiClient,
  defaultApiClient,
  API_PROXY_PROTOCOLS,
  DEFAULT_API_SETTINGS,
  configureApi,
  configureApiSettings,
  getApiSettings,
  getApiErrorMessage,
  getApiErrorUserMessage,
  getErrorMessage,
  imageDescriptorToUrl,
  isApiProxyProtocol,
  normalizeApiSettings,
  normalizeApiUrl,
  requestBlob,
  requestJson,
  requestJsonResponse,
  requestText,
  testApiConnection,
  validateApiSettings,
} from './client'

export {
  API_SETTINGS_STORAGE_KEY,
  ApiSettingsStorageError,
  clearPersistedApiSettings,
  loadPersistedApiSettings,
  savePersistedApiSettings,
} from './settings-storage'

export {
  DEFAULT_THUMBNAIL_COLUMNS,
  DEFAULT_COLOR_THEME,
  DISPLAY_SETTINGS_STORAGE_KEY,
  DisplaySettingsStorageError,
  MAX_THUMBNAIL_COLUMNS,
  MIN_THUMBNAIL_COLUMNS,
  isThumbnailColumnCount,
  isColorTheme,
  loadPersistedDisplaySettings,
  normalizeDisplaySettings,
  normalizeThumbnailColumnCount,
  normalizeColorTheme,
  savePersistedDisplaySettings,
} from './display-settings-storage'

export type {
  ApiErrorCategory,
  ApiErrorOptions,
  ApiImageRequestDescriptor,
  ApiJsonResponse,
  ApiQuery,
  ApiQueryValue,
  ApiRequestOptions,
  ApiProxyProtocol,
  ApiProxySettings,
  ApiSettings,
  ApiSettingsErrors,
  ApiSettingsInput,
  ApiSettingsValidation,
} from './client'

export type {
  ColorTheme,
  DisplaySettings,
  ThumbnailColumnCount,
} from './display-settings-storage'

export * from './books'
export * from './book-tags'
export * from './dashboard'
export * from './endpoints'
export * from './hitomi'
