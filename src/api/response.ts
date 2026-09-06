import { ApiError } from './client'

export type ApiResponse = {
  success?: boolean
  message?: string | null
}

export type ApiEnvelope<T> = ApiResponse & { data?: T | null }

/** Explicit opt-in: transport and direct-response endpoints do not use this policy. */
export const createEnvelopePolicy = (fallbackMessage: string) => {
  const failureMessage = (response?: ApiResponse | null) => (
    response?.message?.trim() || fallbackMessage
  )

  const assertSuccess = (response: (ApiResponse & { data?: unknown }) | null | undefined): void => {
    if (response?.success === false) {
      const data = response.data
      const errors = data && typeof data === 'object' && 'errors' in data && Array.isArray(data.errors)
        ? data.errors.filter((value): value is string => typeof value === 'string')
        : undefined
      throw new ApiError(failureMessage(response), { validationErrors: errors })
    }
  }

  const unwrapData = <T>(response: ApiEnvelope<T>): T => {
    assertSuccess(response)
    if (response.data === undefined || response.data === null) {
      throw new ApiError(failureMessage(response))
    }
    return response.data
  }

  return { assertSuccess, unwrapData }
}
