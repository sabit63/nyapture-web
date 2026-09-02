import { useEffect, useState } from 'react'
import { getApiSettings } from '../api'
import {
  bookDownloadHubClient,
  type BookDownloadHubConnectionState,
} from './book-download-hub'

/**
 * Owns the shared BookDownloadHub lifecycle for routes that need realtime
 * download status updates. Consumers subscribe to event payloads separately.
 */
export const useBookDownloadHubConnection = (
  enabled: boolean,
  apiRevision: number,
): BookDownloadHubConnectionState => {
  const [connectionState, setConnectionState] = useState<BookDownloadHubConnectionState>(
    () => bookDownloadHubClient.connectionState,
  )

  useEffect(() => {
    let active = true

    if (!enabled) {
      setConnectionState('idle')
      void bookDownloadHubClient.stop()
        .catch(() => undefined)
        .then(() => {
          if (active) setConnectionState('idle')
        })
      return () => {
        active = false
        void bookDownloadHubClient.stop().catch(() => undefined)
      }
    }

    const unsubscribe = bookDownloadHubClient.subscribe({
      onConnectionState: (state) => {
        if (active) setConnectionState(state)
      },
    })

    setConnectionState(bookDownloadHubClient.connectionState)
    void bookDownloadHubClient.start(getApiSettings()).catch(() => {
      if (active) setConnectionState('error')
    })

    return () => {
      active = false
      unsubscribe()
      // The shared client serializes this stop before the next effect's start,
      // including when the API revision changes.
      void bookDownloadHubClient.stop().catch(() => undefined)
    }
  }, [enabled, apiRevision])

  return connectionState
}
