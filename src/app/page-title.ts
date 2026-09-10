import { useEffect } from 'react'

import { TAG_TYPE_LABELS, TAG_TYPE_ORDER } from '../models'
import type { BookTag, HitomiAppend, SearchCriteria, TagEntity } from '../models'

export const APP_TITLE = 'Nyapture'

const normalizeTitleValue = (value: string | undefined | null) => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
)

const truncateCodePoints = (value: string, limit: number) => {
  const codePoints = Array.from(value)
  return codePoints.length > limit ? `${codePoints.slice(0, Math.max(0, limit - 1)).join('')}…` : value
}

const formatPageNumber = (value: number) => (
  Number.isSafeInteger(value) && value >= 1 ? value : 1
)

/** Format a route title using the site's fixed suffix and optional hierarchy. */
export const formatPageTitle = (page?: string, parent?: string) => {
  const pageValue = normalizeTitleValue(page)
  const parentValue = normalizeTitleValue(parent)
  const routeTitle = [pageValue, parentValue].filter(Boolean).join(' - ')
  return routeTitle ? `${routeTitle} | ${APP_TITLE}` : APP_TITLE
}

const resolveTagTitle = (tag: BookTag, responseTags: TagEntity[]) => {
  const criteriaDisplayName = normalizeTitleValue(tag.displayName)
  if (criteriaDisplayName) return criteriaDisplayName

  const responseTag = responseTags.find((candidate) => (
    candidate.type === tag.type && candidate.name === tag.name
  ))
  return normalizeTitleValue(responseTag?.displayName) || normalizeTitleValue(tag.name)
}

const formatConditionSummary = (
  criteria: SearchCriteria,
  hitomiAppend: HitomiAppend,
  responseTags: TagEntity[],
) => {
  const conditions: string[] = []
  const text = normalizeTitleValue(criteria.text)
  if (text) conditions.push(`検索: ${text}`)

  TAG_TYPE_ORDER.forEach((type) => {
    const values = criteria.tags
      .filter((tag) => tag.type === type)
      .map((tag) => resolveTagTitle(tag, responseTags))
      .filter(Boolean)
    if (values.length > 0) conditions.push(`${TAG_TYPE_LABELS[type]}: ${values.join(', ')}`)
  })

  const dateFrom = normalizeTitleValue(criteria.dateFrom)
  const dateTo = normalizeTitleValue(criteria.dateTo)
  if (dateFrom || dateTo) conditions.push(`日時: ${dateFrom}〜${dateTo}`)

  const pagesMin = normalizeTitleValue(criteria.pagesMin)
  const pagesMax = normalizeTitleValue(criteria.pagesMax)
  if (pagesMin || pagesMax) conditions.push(`ページ数: ${pagesMin}〜${pagesMax}`)

  const append = normalizeTitleValue(hitomiAppend)
  if (append && append !== 'Normal') conditions.push(`HitomiAppend: ${append}`)

  return truncateCodePoints(conditions.join(' / '), 80)
}

export type SearchPageTitleInput = {
  isWebSearch: boolean
  isMissingTagSearch?: boolean
  isStatusSearch?: boolean
  isLibrarySearch: boolean
  criteria: SearchCriteria
  hitomiAppend: HitomiAppend
  resultPage: number
  responseTags?: TagEntity[]
}

/** Format the browser title for a committed search route state. */
export const formatSearchPageTitle = ({
  isWebSearch,
  isLibrarySearch,
  isMissingTagSearch = false,
  isStatusSearch = false,
  criteria,
  hitomiAppend,
  resultPage,
  responseTags = [],
}: SearchPageTitleInput) => {
  if (!isWebSearch && !isLibrarySearch) return APP_TITLE

  const missingSummary = isMissingTagSearch && criteria.missingTagTypes?.length
    ? `すべて未設定: ${criteria.missingTagTypes.map((type) => TAG_TYPE_LABELS[type]).join('・')}`
    : ''
  const summary = [missingSummary, formatConditionSummary(criteria, hitomiAppend, responseTags)].filter(Boolean).join(' / ')
  if (isStatusSearch) return formatPageTitle(summary ? `${summary}${resultPage > 1 ? ` / ${formatPageNumber(resultPage)}P` : ''}` : resultPage > 1 ? `${formatPageNumber(resultPage)}P` : undefined, 'ステータス検索')
  if (isMissingTagSearch) return formatPageTitle(summary ? `${summary}${resultPage > 1 ? ` / ${formatPageNumber(resultPage)}P` : ''}` : undefined, '未タグ検索')
  if (!summary) return isWebSearch ? formatPageTitle('Hitomi') : APP_TITLE

  const pageNumber = formatPageNumber(resultPage)
  const searchTitle = pageNumber > 1 ? `${summary} / ${pageNumber}P` : summary
  return isWebSearch ? formatPageTitle(searchTitle, 'Hitomi') : formatPageTitle(searchTitle)
}

/** Keep document.title synchronized with the current route's title. */
export const useDocumentTitle = (title: string) => {
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = title
  }, [title])
}
