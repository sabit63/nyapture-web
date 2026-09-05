import { useCallback, useRef, useState, type SetStateAction } from 'react'
import type { WebBookCacheConfigDto, WebBookCacheSiteConfigDto } from '../../models/web-cache'
import { cloneWebCacheConfig, type WebCacheConfigDraft, type WebBookAutoDownloadDraft } from './management-state'

export function useCacheDraft() {
  const [serverConfig, setServerConfig] = useState<WebCacheConfigDraft | null>(null)
  const [allowedGroupIdsText, setAllowedGroupIdsText] = useState('')
  const [excludedTagsText, setExcludedTagsText] = useState('')
  const draftRef = useRef<WebCacheConfigDraft | null>(null)
  const [draft, commitDraft] = useState<WebCacheConfigDraft | null>(null)
  const setDraft = useCallback((action: SetStateAction<WebCacheConfigDraft | null>) => {
    const next = typeof action === 'function' ? action(draftRef.current) : action
    draftRef.current = next
    commitDraft(next)
  }, [])
  const applyEditableConfig = useCallback((config: WebBookCacheConfigDto) => {
    const nextDraft = cloneWebCacheConfig(config)
    draftRef.current = nextDraft
    setDraft(nextDraft)
    setAllowedGroupIdsText(nextDraft.autoDownload.allowedGroupIds.join('\n'))
    setExcludedTagsText(nextDraft.autoDownload.excludedTags.join('\n'))
  }, [setDraft])

  const updateDraft = useCallback((updater: (current: WebCacheConfigDraft) => WebCacheConfigDraft) => {
    setDraft((current) => current ? updater(current) : current)
  }, [setDraft])

  const updateGlobalNumber = useCallback((field: 'intervalMinutes' | 'initialLookbackDays' | 'maxPagesPerRun' | 'maxDetailsPerRun', value: number) => {
    updateDraft((current) => ({ ...current, [field]: value }))
  }, [updateDraft])

  const updateAutoDownload = useCallback(<K extends keyof WebBookAutoDownloadDraft>(field: K, value: WebBookAutoDownloadDraft[K]) => {
    updateDraft((current) => ({
      ...current,
      autoDownload: {
        ...current.autoDownload,
        [field]: value,
      },
    }))
  }, [updateDraft])

  const updateSite = useCallback(<K extends keyof WebBookCacheSiteConfigDto>(index: number, field: K, value: WebBookCacheSiteConfigDto[K]) => {
    updateDraft((current) => ({
      ...current,
      sites: current.sites.map((site, siteIndex) => siteIndex === index ? { ...site, [field]: value } : site),
    }))
  }, [updateDraft])

  return { serverConfig, setServerConfig, draft, setDraft, draftRef, allowedGroupIdsText, setAllowedGroupIdsText, excludedTagsText, setExcludedTagsText, applyEditableConfig, updateDraft, updateGlobalNumber, updateAutoDownload, updateSite }
}
