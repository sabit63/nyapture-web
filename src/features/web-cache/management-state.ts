import type {
  WebBookAutoDownloadConfigDto,
  WebBookCacheConfigDto,
  WebBookCacheSiteConfigDto,
  WebBookCacheStatusResponse,
} from '../../models/web-cache'

export type WebCacheConfigValidationIssue = {
  path?: string
  message: string
}

export type WebBookAutoDownloadDraft = Omit<WebBookAutoDownloadConfigDto, 'enabled' | 'conditionMode' | 'maxPageCount' | 'maxAutoDownloadsPerRun' | 'maxAutoDownloadsPerDay' | 'minFreeDiskGb' | 'allowedGroupIds' | 'excludedTags'> & {
  enabled: boolean
  conditionMode: string
  maxPageCount: number
  maxAutoDownloadsPerRun: number
  maxAutoDownloadsPerDay: number
  minFreeDiskGb: number
  allowedGroupIds: string[]
  excludedTags: string[]
}

export type WebCacheConfigDraft = Omit<WebBookCacheConfigDto, 'enabled' | 'intervalMinutes' | 'initialLookbackDays' | 'maxPagesPerRun' | 'maxDetailsPerRun' | 'sites' | 'autoDownload'> & {
  enabled: boolean
  intervalMinutes: number
  initialLookbackDays: number
  maxPagesPerRun: number
  maxDetailsPerRun: number
  sites: WebBookCacheSiteConfigDto[]
  autoDownload: WebBookAutoDownloadDraft
}

const DEFAULT_AUTO_DOWNLOAD: WebBookAutoDownloadDraft = {
  enabled: false,
  conditionMode: 'All',
  maxPageCount: 200,
  maxAutoDownloadsPerRun: 10,
  maxAutoDownloadsPerDay: 50,
  minFreeDiskGb: 20,
  allowedGroupIds: [],
  excludedTags: [],
}

const DEFAULT_CONFIG: WebCacheConfigDraft = {
  enabled: false,
  intervalMinutes: 60,
  initialLookbackDays: 7,
  maxPagesPerRun: 20,
  maxDetailsPerRun: 200,
  sites: [],
  autoDownload: DEFAULT_AUTO_DOWNLOAD,
  updatedAt: null,
  updatedBy: null,
}

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

const cloneSite = (site: WebBookCacheSiteConfigDto): WebBookCacheSiteConfigDto => ({
  ...site,
})

const cloneAutoDownload = (config?: WebBookAutoDownloadConfigDto | null): WebBookAutoDownloadDraft => ({
  ...DEFAULT_AUTO_DOWNLOAD,
  ...(config ?? {}),
  allowedGroupIds: [...(config?.allowedGroupIds ?? [])],
  excludedTags: [...(config?.excludedTags ?? [])],
})

/** Fill omitted API fields while making a fully independent editable draft. */
export const normalizeWebCacheConfig = (
  config?: Partial<WebBookCacheConfigDto> | null,
): WebCacheConfigDraft => ({
  ...DEFAULT_CONFIG,
  ...(config ?? {}),
  sites: (config?.sites ?? []).map(cloneSite),
  autoDownload: cloneAutoDownload(config?.autoDownload),
})

/** Deep clone the editable settings so status/config refreshes cannot mutate a draft. */
export const cloneWebCacheConfig = (
  config?: Partial<WebBookCacheConfigDto> | null,
): WebCacheConfigDraft => normalizeWebCacheConfig(config)

const issue = (path: string | undefined, message: string): WebCacheConfigValidationIssue => ({ path, message })

const positiveIntegerIssue = (
  value: unknown,
  path: string,
  label: string,
  allowZero = false,
): WebCacheConfigValidationIssue | null => {
  if (!isFiniteNumber(value) || !Number.isInteger(value) || (allowZero ? value < 0 : value < 1)) {
    return issue(path, `${label}は${allowZero ? '0以上' : '1以上'}の整数で入力してください。`)
  }
  return null
}

/** Validate errors that can be assigned to a concrete local form field. */
export const validateWebCacheDraft = (
  config: WebCacheConfigDraft,
): WebCacheConfigValidationIssue[] => {
  const issues: WebCacheConfigValidationIssue[] = []
  const intervalIssue = positiveIntegerIssue(config.intervalMinutes, 'intervalMinutes', '同期間隔')
  const lookbackIssue = positiveIntegerIssue(config.initialLookbackDays, 'initialLookbackDays', '初回探索日数', true)
  const pagesIssue = positiveIntegerIssue(config.maxPagesPerRun, 'maxPagesPerRun', '1回の最大ページ数')
  const detailsIssue = positiveIntegerIssue(config.maxDetailsPerRun, 'maxDetailsPerRun', '1回の最大詳細件数')
  if (intervalIssue) issues.push(intervalIssue)
  if (lookbackIssue) issues.push(lookbackIssue)
  if (pagesIssue) issues.push(pagesIssue)
  if (detailsIssue) issues.push(detailsIssue)

  const seenGroupIds = new Set<string>()
  for (const [index, site] of (config.sites ?? []).entries()) {
    const groupId = site.groupId?.trim() ?? ''
    const groupPath = `sites.${index}.groupId`
    if (!groupId) issues.push(issue(groupPath, 'GroupIdを入力してください。'))
    else if (seenGroupIds.has(groupId)) issues.push(issue(groupPath, 'GroupIdが重複しています。'))
    else seenGroupIds.add(groupId)

    const startUrl = site.startUrl?.trim() ?? ''
    if (site.enabled && !startUrl) issues.push(issue(`sites.${index}.startUrl`, '有効なサイトにはStartUrlが必要です。'))
    if (startUrl) {
      try {
        const parsed = new URL(startUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
      } catch {
        issues.push(issue(`sites.${index}.startUrl`, 'StartUrlにはhttp://またはhttps://のURLを入力してください。'))
      }
    }

    const siteIntervalIssue = site.intervalMinutes === null || site.intervalMinutes === undefined
      ? null
      : positiveIntegerIssue(site.intervalMinutes, `sites.${index}.intervalMinutes`, 'サイト同期間隔')
    const sitePagesIssue = site.maxPagesPerRun === null || site.maxPagesPerRun === undefined
      ? null
      : positiveIntegerIssue(site.maxPagesPerRun, `sites.${index}.maxPagesPerRun`, 'サイト最大ページ数')
    const siteDetailsIssue = site.maxDetailsPerRun === null || site.maxDetailsPerRun === undefined
      ? null
      : positiveIntegerIssue(site.maxDetailsPerRun, `sites.${index}.maxDetailsPerRun`, 'サイト最大詳細件数')
    const domainIntervalIssue = site.domainIntervalMilliseconds === null || site.domainIntervalMilliseconds === undefined
      ? null
      : positiveIntegerIssue(site.domainIntervalMilliseconds, `sites.${index}.domainIntervalMilliseconds`, 'ドメイン間隔', true)
    if (siteIntervalIssue) issues.push(siteIntervalIssue)
    if (sitePagesIssue) issues.push(sitePagesIssue)
    if (siteDetailsIssue) issues.push(siteDetailsIssue)
    if (domainIntervalIssue) issues.push(domainIntervalIssue)
  }

  const autoDownload = config.autoDownload ?? DEFAULT_AUTO_DOWNLOAD
  if (autoDownload.conditionMode !== 'All' && autoDownload.conditionMode !== 'Any') {
    issues.push(issue('autoDownload.conditionMode', '条件の組み合わせはAllまたはAnyを選択してください。'))
  }
  const autoPageIssue = positiveIntegerIssue(autoDownload.maxPageCount, 'autoDownload.maxPageCount', '自動ダウンロードの最大ページ数')
  const autoRunIssue = positiveIntegerIssue(autoDownload.maxAutoDownloadsPerRun, 'autoDownload.maxAutoDownloadsPerRun', '1回の自動投入上限', true)
  const autoDayIssue = positiveIntegerIssue(autoDownload.maxAutoDownloadsPerDay, 'autoDownload.maxAutoDownloadsPerDay', '1日の自動投入上限', true)
  if (autoPageIssue) issues.push(autoPageIssue)
  if (autoRunIssue) issues.push(autoRunIssue)
  if (autoDayIssue) issues.push(autoDayIssue)
  if (!isFiniteNumber(autoDownload.minFreeDiskGb) || autoDownload.minFreeDiskGb < 0) {
    issues.push(issue('autoDownload.minFreeDiskGb', '必要な空き容量は0以上の数値で入力してください。'))
  }

  return issues
}

export const validationMessages = (issues: readonly WebCacheConfigValidationIssue[]): string[] => (
  issues.map(({ message }) => message)
)

export const isCacheStatusRunning = (
  status?: Pick<WebBookCacheStatusResponse, 'isRunning'> | null,
) => status?.isRunning === true

/** Polling is active only while the service reports an active synchronization. */
export const shouldPollCacheStatus = isCacheStatusRunning

/**
 * Start a serial status poll. The next timer is scheduled only after the
 * previous load settles, so a slow request can never be aborted by the next
 * tick. The returned cleanup function also suppresses a timer scheduled after
 * an in-flight request resolves.
 */
export const startSerialCachePolling = <TTimer>(
  load: () => Promise<unknown>,
  schedule: (callback: () => void, delayMs: number) => TTimer,
  cancel: (timer: TTimer) => void,
  delayMs = 2000,
) => {
  let stopped = false
  let timer: TTimer | undefined

  const run = async () => {
    if (stopped) return
    try {
      await load()
    } catch {
      // The caller displays request errors; keep the running-state poll alive.
    }
    if (stopped) return
    timer = schedule(() => { void run() }, delayMs)
  }

  timer = schedule(() => { void run() }, delayMs)
  return () => {
    stopped = true
    if (timer !== undefined) cancel(timer)
  }
}

export const canSaveWebCacheConfig = (
  draft: WebCacheConfigDraft | null,
  saving: boolean,
  validating: boolean,
) => draft !== null && !saving && !validating

export const createCacheSyncRequest = (groupId: string, force: boolean) => ({
  groupId: groupId.trim() || null,
  force,
})

/** Reject a response from a previous API settings revision or an older request. */
export const isCurrentCacheRequest = (
  requestRevision: number,
  currentRevision: number,
  requestId: number,
  latestRequestId: number,
) => requestRevision === currentRevision && requestId === latestRequestId

export const getValidationMessagesFromError = (error: unknown): string[] => {
  if (!error || typeof error !== 'object') return []
  const values = (error as { validationErrors?: unknown }).validationErrors
  if (!Array.isArray(values)) return []
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}
