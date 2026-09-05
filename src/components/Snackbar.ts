import { useCallback, useRef, useState } from 'react'

export type SnackbarTone = 'success' | 'warning' | 'error'

export type SnackbarNotice = {
  id: number
  message: string
  tone: SnackbarTone
}

export const useSnackbar = () => {
  const [notice, setNotice] = useState<SnackbarNotice | null>(null)
  const nextIdRef = useRef(0)

  const notify = useCallback((message: string, tone: SnackbarTone = 'success') => {
    const id = nextIdRef.current + 1
    nextIdRef.current = id
    setNotice({ id, message, tone })
  }, [])

  const dismiss = useCallback((id?: number) => {
    setNotice((current) => id === undefined || current?.id === id ? null : current)
  }, [])

  return { notice, notify, dismiss }
}

export { Snackbar } from './SnackbarView'
