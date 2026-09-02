import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr'
import type { ApiSettings } from '../api/client'
import type { BookDownloadStatus, BookDownloadSystemStatus } from '../models'

export type BookDownloadHubConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export type BookDownloadHubStatusEventKind =
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'statusUpdate'

export interface BookDownloadHubListener {
  onConnectionState?: (state: BookDownloadHubConnectionState) => void
  onStatus?: (kind: BookDownloadHubStatusEventKind, status: BookDownloadStatus) => void
  onRunningDownloads?: (statuses: BookDownloadStatus[]) => void
  onQueuedDownloads?: (statuses: BookDownloadStatus[]) => void
  onAllDownloadStatuses?: (statuses: Record<string, BookDownloadStatus>) => void
  onSystemStatus?: (status: BookDownloadSystemStatus) => void
  onBookDownloadStatus?: (status: BookDownloadStatus) => void
  onBookDownloadStatusNotFound?: (key: string) => void
  onResyncRequested?: () => void
}

export const BOOK_DOWNLOAD_HUB_EVENTS = {
  BookDownloadStarted: 'BookDownloadStarted',
  BookDownloadProgress: 'BookDownloadProgress',
  BookDownloadCompleted: 'BookDownloadCompleted',
  BookDownloadFailed: 'BookDownloadFailed',
  BookDownloadCancelled: 'BookDownloadCancelled',
  BookDownloadStatusUpdate: 'BookDownloadStatusUpdate',
  ReceiveRunningDownloads: 'ReceiveRunningDownloads',
  ReceiveQueuedDownloads: 'ReceiveQueuedDownloads',
  ReceiveAllDownloadStatuses: 'ReceiveAllDownloadStatuses',
  ReceiveSystemStatus: 'ReceiveSystemStatus',
  ReceiveBookDownloadStatus: 'ReceiveBookDownloadStatus',
  BookDownloadStatusNotFound: 'BookDownloadStatusNotFound',
} as const

const BOOK_DOWNLOAD_HUB_SERVER_METHODS = {
  joinGlobalMonitoring: 'JoinGlobalMonitoring',
  leaveGlobalMonitoring: 'LeaveGlobalMonitoring',
} as const

const AUTOMATIC_RECONNECT_DELAYS = [0, 2000, 5000, 10000]
const MANUAL_RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]

type HubSettings = Pick<ApiSettings, 'apiUrl' | 'apiKey'>
type EventHandler = (payload: unknown) => void
type RegisteredHandler = {
  event: string
  handler: EventHandler
}

const normalizeSettings = (settings: HubSettings): HubSettings => ({
  apiUrl: settings.apiUrl.trim().replace(/\/+$/, ''),
  apiKey: settings.apiKey,
})

const sameSettings = (first: HubSettings | null, second: HubSettings | null) => (
  first !== null
  && second !== null
  && first.apiUrl === second.apiUrl
  && first.apiKey === second.apiKey
)

const hubUrlFor = (settings: HubSettings) => `${settings.apiUrl}/api/bookDownloadHub`

/**
 * Shared browser client for the BookDownloadHub.
 *
 * The client deliberately keeps transport concerns here. Consumers receive
 * typed notifications and can use REST snapshots as the source of truth.
 */
export class BookDownloadHubClient {
  private readonly listeners = new Set<BookDownloadHubListener>()
  private lifecycle: Promise<void> = Promise.resolve()
  private teardown: Promise<void> = Promise.resolve()
  private connection: HubConnection | null = null
  private connectionSettings: HubSettings | null = null
  private requestedSettings: HubSettings | null = null
  private registeredHandlers: RegisteredHandler[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private generation = 0
  private state: BookDownloadHubConnectionState = 'idle'
  private startRequested = false

  get connectionState(): BookDownloadHubConnectionState {
    return this.state
  }

  subscribe(listener: BookDownloadHubListener): () => void {
    this.listeners.add(listener)
    let subscribed = true

    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
    }
  }

  start(settings: Pick<ApiSettings, 'apiUrl' | 'apiKey'>): Promise<void> {
    const nextSettings = normalizeSettings(settings)
    this.startRequested = true
    this.requestedSettings = nextSettings
    this.cancelRetry()
    this.retryAttempt = 0

    return this.enqueue(() => this.startInternal(nextSettings))
  }

  stop(): Promise<void> {
    this.startRequested = false
    this.requestedSettings = null
    this.cancelRetry()
    this.retryAttempt = 0
    this.generation += 1

    return this.enqueue(() => this.stopInternal())
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.lifecycle.catch(() => undefined).then(operation)
    this.lifecycle = next.catch(() => undefined)
    return next
  }

  private async startInternal(settings: HubSettings): Promise<void> {
    if (!this.startRequested || !sameSettings(settings, this.requestedSettings)) return

    await this.teardown

    if (
      this.connection
      && sameSettings(settings, this.connectionSettings)
      && (
        this.state === 'connecting'
        || this.state === 'connected'
        || this.state === 'reconnecting'
      )
    ) {
      return
    }

    if (this.connection) {
      await this.disposeCurrentConnection()
    }
    if (!this.startRequested || !sameSettings(settings, this.requestedSettings)) return

    const generation = ++this.generation
    this.setState('connecting')

    let connection: HubConnection | null = null
    let handlers: RegisteredHandler[] = []
    try {
      connection = new HubConnectionBuilder()
        .withUrl(hubUrlFor(settings), {
          accessTokenFactory: () => settings.apiKey,
          withCredentials: false,
        })
        .withAutomaticReconnect(AUTOMATIC_RECONNECT_DELAYS)
        .configureLogging(LogLevel.None)
        .build()

      this.connection = connection
      this.connectionSettings = settings
      handlers = this.registerEventHandlers(connection, generation)
      this.registeredHandlers = handlers
      this.registerConnectionHandlers(connection, generation)

      await connection.start()
      if (!this.isCurrentConnection(connection, generation)) {
        await this.disposeConnection(connection, handlers, connection.state === HubConnectionState.Connected)
        return
      }

      await connection.invoke(BOOK_DOWNLOAD_HUB_SERVER_METHODS.joinGlobalMonitoring)
      if (!this.isCurrentConnection(connection, generation)) {
        await this.disposeConnection(connection, handlers, connection.state === HubConnectionState.Connected)
        return
      }

      this.retryAttempt = 0
      this.cancelRetry()
      this.setState('connected')
      this.notifyListeners((listener) => listener.onResyncRequested?.())
    } catch {
      if (connection && this.isCurrentConnection(connection, generation)) {
        this.setState('error')
        await this.disposeCurrentConnection()
        this.scheduleRetry(settings)
      } else if (connection) {
        await this.disposeConnection(connection, handlers, connection.state === HubConnectionState.Connected)
      } else {
        this.setState('error')
        this.scheduleRetry(settings)
      }
    }
  }

  private async stopInternal(): Promise<void> {
    await this.disposeCurrentConnection()
    this.connectionSettings = null
    this.setState('idle')
  }

  private registerEventHandlers(connection: HubConnection, generation: number): RegisteredHandler[] {
    const handlers: RegisteredHandler[] = []
    const register = <T>(event: string, callback: (payload: T) => void) => {
      const handler: EventHandler = (payload) => {
        if (!this.isCurrentConnection(connection, generation)) return
        try {
          callback(payload as T)
        } catch {
          // A consumer callback must never break SignalR's dispatch loop.
        }
      }
      connection.on(event, handler)
      handlers.push({ event, handler })
    }

    register<BookDownloadStatus>(BOOK_DOWNLOAD_HUB_EVENTS.BookDownloadStarted, (status) => {
      this.notifyListeners((listener) => listener.onStatus?.('started', status))
    })
    register<BookDownloadStatus>(BOOK_DOWNLOAD_HUB_EVENTS.BookDownloadProgress, (status) => {
      this.notifyListeners((listener) => listener.onStatus?.('progress', status))
    })
    register<BookDownloadStatus>(BOOK_DOWNLOAD_HUB_EVENTS.BookDownloadCompleted, (status) => {
      this.notifyListeners((listener) => listener.onStatus?.('completed', status))
    })
    register<BookDownloadStatus>(BOOK_DOWNLOAD_HUB_EVENTS.BookDownloadFailed, (status) => {
      this.notifyListeners((listener) => listener.onStatus?.('failed', status))
    })
    register<BookDownloadStatus>(BOOK_DOWNLOAD_HUB_EVENTS.BookDownloadCancelled, (status) => {
      this.notifyListeners((listener) => listener.onStatus?.('cancelled', status))
    })
    register<BookDownloadStatus>(BOOK_DOWNLOAD_HUB_EVENTS.BookDownloadStatusUpdate, (status) => {
      this.notifyListeners((listener) => listener.onStatus?.('statusUpdate', status))
    })
    register<BookDownloadStatus[]>(BOOK_DOWNLOAD_HUB_EVENTS.ReceiveRunningDownloads, (statuses) => {
      this.notifyListeners((listener) => listener.onRunningDownloads?.(statuses))
    })
    register<BookDownloadStatus[]>(BOOK_DOWNLOAD_HUB_EVENTS.ReceiveQueuedDownloads, (statuses) => {
      this.notifyListeners((listener) => listener.onQueuedDownloads?.(statuses))
    })
    register<Record<string, BookDownloadStatus>>(BOOK_DOWNLOAD_HUB_EVENTS.ReceiveAllDownloadStatuses, (statuses) => {
      this.notifyListeners((listener) => listener.onAllDownloadStatuses?.(statuses))
    })
    register<BookDownloadSystemStatus>(BOOK_DOWNLOAD_HUB_EVENTS.ReceiveSystemStatus, (status) => {
      this.notifyListeners((listener) => listener.onSystemStatus?.(status))
    })
    register<BookDownloadStatus>(BOOK_DOWNLOAD_HUB_EVENTS.ReceiveBookDownloadStatus, (status) => {
      this.notifyListeners((listener) => listener.onBookDownloadStatus?.(status))
    })
    register<string>(BOOK_DOWNLOAD_HUB_EVENTS.BookDownloadStatusNotFound, (key) => {
      this.notifyListeners((listener) => listener.onBookDownloadStatusNotFound?.(key))
    })

    return handlers
  }

  private registerConnectionHandlers(connection: HubConnection, generation: number) {
    connection.onreconnecting(() => {
      if (!this.isCurrentConnection(connection, generation)) return
      this.setState('reconnecting')
    })

    connection.onreconnected(() => {
      void this.handleReconnected(connection, generation)
    })

    connection.onclose((error) => {
      void this.handleClosed(connection, generation, error)
    })
  }

  private async handleReconnected(connection: HubConnection, generation: number): Promise<void> {
    if (!this.isCurrentConnection(connection, generation)) return

    this.setState('connected')
    try {
      await connection.invoke(BOOK_DOWNLOAD_HUB_SERVER_METHODS.joinGlobalMonitoring)
      if (!this.isCurrentConnection(connection, generation)) return
      this.retryAttempt = 0
      this.cancelRetry()
      this.notifyListeners((listener) => listener.onResyncRequested?.())
    } catch {
      if (!this.isCurrentConnection(connection, generation)) return
      this.setState('error')
      const settings = this.connectionSettings
      await this.disposeCurrentConnection()
      if (settings) this.scheduleRetry(settings)
    }
  }

  private async handleClosed(connection: HubConnection, generation: number, error?: Error): Promise<void> {
    if (!this.isCurrentConnection(connection, generation)) return

    const settings = this.connectionSettings
    this.setState(error ? 'error' : 'disconnected')
    await this.disposeCurrentConnection()
    if (settings) this.scheduleRetry(settings)
  }

  private isCurrentConnection(connection: HubConnection, generation: number): boolean {
    return (
      this.startRequested
      && this.connection === connection
      && this.generation === generation
      && sameSettings(this.requestedSettings, this.connectionSettings)
    )
  }

  private disposeCurrentConnection(): Promise<void> {
    const nextTeardown = this.teardown
      .catch(() => undefined)
      .then(() => this.disposeCurrentConnectionInternal())
    this.teardown = nextTeardown.catch(() => undefined)
    return nextTeardown
  }

  private async disposeCurrentConnectionInternal(): Promise<void> {
    const connection = this.connection
    if (!connection) return

    const handlers = this.registeredHandlers
    const shouldLeave = connection.state === HubConnectionState.Connected
    this.connection = null
    this.connectionSettings = null
    this.registeredHandlers = []
    this.generation += 1
    await this.disposeConnection(connection, handlers, shouldLeave)
  }

  private async disposeConnection(
    connection: HubConnection,
    handlers: RegisteredHandler[],
    shouldLeave: boolean,
  ): Promise<void> {
    handlers.forEach(({ event, handler }) => {
      try {
        connection.off(event, handler)
      } catch {
        // Removing a handler is best effort during teardown.
      }
    })

    if (shouldLeave) {
      try {
        await connection.invoke(BOOK_DOWNLOAD_HUB_SERVER_METHODS.leaveGlobalMonitoring)
      } catch {
        // Leaving is best effort; teardown must continue if the server is gone.
      }
    }

    try {
      await connection.stop()
    } catch {
      // A failed stop must not leave a retry or page transition hanging.
    }

    const disposable = connection as unknown as {
      dispose?: () => Promise<void> | void
      disposeAsync?: () => Promise<void> | void
    }
    try {
      if (typeof disposable.disposeAsync === 'function') await disposable.disposeAsync()
      else if (typeof disposable.dispose === 'function') await disposable.dispose()
    } catch {
      // SignalR HubConnection currently exposes stop rather than dispose; a
      // test/custom implementation may expose either, both are best effort.
    }
  }

  private scheduleRetry(settings: HubSettings) {
    if (!this.startRequested || !sameSettings(settings, this.requestedSettings)) return
    if (this.retryTimer !== null || this.retryAttempt >= MANUAL_RETRY_DELAYS.length) return

    const delay = MANUAL_RETRY_DELAYS[this.retryAttempt]
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.startRequested || !sameSettings(settings, this.requestedSettings)) return
      void this.enqueue(() => this.startInternal(settings))
    }, delay)
  }

  private cancelRetry() {
    if (this.retryTimer === null) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private setState(state: BookDownloadHubConnectionState) {
    if (this.state === state) return
    this.state = state
    this.notifyListeners((listener) => listener.onConnectionState?.(state))
  }

  private notifyListeners(notify: (listener: BookDownloadHubListener) => void) {
    Array.from(this.listeners).forEach((listener) => {
      try {
        notify(listener)
      } catch {
        // Listener failures are isolated from SignalR and other subscribers.
      }
    })
  }
}

export const bookDownloadHubClient = new BookDownloadHubClient()
