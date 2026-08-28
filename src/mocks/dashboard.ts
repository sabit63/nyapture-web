/**
 * Dashboard response models mirror the dashboard contracts in docs/openapi.yaml.
 * Fields are optional/nullable here so the mock can also represent a partially
 * observed response while the UI exercises its safe fallbacks.
 */

export interface DataStoreSummary {
  generatedAt?: string | null
  isConnected?: boolean | null
  providerVersion?: string | null
  storeName?: string | null
  availability?: string | null
  diagnosticCode?: string | null
}

export interface MongoSummary {
  isConnected?: boolean | null
  serverVersion?: string | null
  databaseName?: string | null
}

export interface DataFolderSummary {
  isAvailable?: boolean | null
  freeBytes?: number | null
  totalBytes?: number | null
  /** DataFolderResponse exposes usageRatio when the detail endpoint is used. */
  usageRatio?: number | null
}

export interface DownloadsSummary {
  runningCount?: number | null
  queuedCount?: number | null
  failedRecentCount?: number | null
}

export interface WebPilotSummary {
  isConfigured?: boolean | null
  lastTestStatus?: string | null
}

export interface ImageWorkerSummary {
  isConfigured?: boolean | null
  lastTestStatus?: string | null
}

export interface MaintenanceSummary {
  lastExecutionTime?: string | null
  nextExecutionTime?: string | null
  isRunning?: boolean | null
  issuesCount?: number | null
}

export interface CacheSummary {
  sizeBytes?: number | null
  entryCount?: number | null
  hitRate?: number | null
}

export interface LogsSummary {
  errors24h?: number | null
  warnings24h?: number | null
}

export interface DashboardSummaryResponse {
  generatedAt?: string | null
  dataStore?: DataStoreSummary | null
  /** Legacy MongoDB-compatible summary from the API contract. */
  mongoDb?: MongoSummary | null
  dataFolder?: DataFolderSummary | null
  downloads?: DownloadsSummary | null
  webPilot?: WebPilotSummary | null
  imageWorker?: ImageWorkerSummary | null
  maintenance?: MaintenanceSummary | null
  cache?: CacheSummary | null
  logs?: LogsSummary | null
  errors?: Record<string, string> | null
}

export interface DashboardLogEntryDto {
  sequence?: number | null
  timestamp?: string | null
  level?: string | null
  category?: string | null
  message?: string | null
  exception?: string | null
}

export interface DashboardLogsResponse {
  generatedAt?: string | null
  latestSequence?: number | null
  entries?: DashboardLogEntryDto[] | null
}

const MOCK_GENERATED_AT = '2026-08-29T09:30:00+09:00'

export const DASHBOARD_MOCK_DATA: DashboardSummaryResponse = {
  generatedAt: MOCK_GENERATED_AT,
  dataStore: {
    generatedAt: MOCK_GENERATED_AT,
    isConnected: true,
    providerVersion: 'MongoDB 7.0',
    storeName: 'nyapture',
    availability: 'Available',
    diagnosticCode: null,
  },
  mongoDb: {
    isConnected: true,
    serverVersion: '7.0',
    databaseName: 'nyapture',
  },
  dataFolder: {
    isAvailable: true,
    freeBytes: 24_200_000_000,
    totalBytes: 64_000_000_000,
    // The summary contract has free/total; usageRatio is accepted from the
    // detail response and lets the UI demonstrate the preferred API value.
    usageRatio: 0.621875,
  },
  downloads: {
    runningCount: 2,
    queuedCount: 4,
    failedRecentCount: 1,
  },
  webPilot: {
    isConfigured: true,
    lastTestStatus: 'Success',
  },
  imageWorker: {
    isConfigured: true,
    lastTestStatus: 'Degraded',
  },
  maintenance: {
    lastExecutionTime: '2026-08-29T08:45:00+09:00',
    nextExecutionTime: '2026-08-30T03:00:00+09:00',
    isRunning: false,
    issuesCount: 2,
  },
  cache: {
    sizeBytes: 1_280_000_000,
    entryCount: 18_420,
    hitRate: 0.87,
  },
  logs: {
    errors24h: 1,
    warnings24h: 5,
  },
  errors: {},
}

export const DASHBOARD_MOCK_LOGS: DashboardLogsResponse = {
  generatedAt: MOCK_GENERATED_AT,
  latestSequence: 5006,
  entries: [
    {
      sequence: 5006,
      timestamp: '2026-08-29T09:26:00+09:00',
      level: 'Warning',
      category: 'ImageWorker',
      message: 'ImageWorker の応答時間が通常より長くなっています。',
      exception: null,
    },
    {
      sequence: 5005,
      timestamp: '2026-08-29T09:18:00+09:00',
      level: 'Error',
      category: 'Download',
      message: '直近のダウンロード1件でページ取得に失敗しました。',
      exception: null,
    },
    {
      sequence: 5004,
      timestamp: '2026-08-29T08:54:00+09:00',
      level: 'Warning',
      category: 'Maintenance',
      message: 'メンテナンスで2件の問題が検出されています。',
      exception: null,
    },
    {
      sequence: 5003,
      timestamp: '2026-08-29T08:31:00+09:00',
      level: 'Warning',
      category: 'DataFolder',
      message: 'DataFolderの使用率を確認してください。',
      exception: null,
    },
    {
      sequence: 5002,
      timestamp: '2026-08-29T08:12:00+09:00',
      level: 'Warning',
      category: 'Cache',
      message: 'キャッシュのミスが一時的に増加しています。',
      exception: null,
    },
    {
      sequence: 5001,
      timestamp: '2026-08-29T07:48:00+09:00',
      level: 'Warning',
      category: 'WebPilot',
      message: 'WebPilotの接続テスト結果を確認してください。',
      exception: null,
    },
  ],
}

