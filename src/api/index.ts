export {
  ApiClient,
  ApiError,
  apiClient,
  defaultApiClient,
  DEFAULT_API_SETTINGS,
  configureApi,
  configureApiSettings,
  getApiSettings,
  getApiErrorMessage,
  getApiErrorUserMessage,
  getErrorMessage,
  imageDescriptorToUrl,
  normalizeApiSettings,
  normalizeApiUrl,
  requestBlob,
  requestJson,
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

export type {
  ApiErrorCategory,
  ApiErrorOptions,
  ApiImageRequestDescriptor,
  ApiQuery,
  ApiQueryValue,
  ApiRequestOptions,
  ApiSettings,
  ApiSettingsErrors,
  ApiSettingsValidation,
} from './client'

export * from './books'
export * from './endpoints'
export * from './hitomi'
