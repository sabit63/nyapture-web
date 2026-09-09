import type { ReactNode } from 'react'
import type { RecommendationHit, RecommendationResult, RecommendationTagDisplayName } from '../../api/recommendations'

const value = (item: string | number | boolean | null | undefined) => item === undefined ? '未提供' : item === null ? 'null' : String(item)
function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="recommendations__debug-fields">{rows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl>
}
function Tags({ tags, names }: { tags?: string[]; names?: RecommendationTagDisplayName[] }) {
  if (!Array.isArray(tags)) return <>未提供</>
  if (!tags.length) return <>なし</>
  return <ul>{tags.map((name, index) => {
    const translated = names?.find((tag) => tag.type === 'Tags' && tag.name === name)?.displayName?.trim()
    return <li key={index}>{translated && translated !== name ? `${translated} (${name})` : name}</li>
  })}</ul>
}
export function RecommendationResponseDebug({ result }: { result: RecommendationResult }) {
  return <section className="recommendations__debug" aria-label="レコメンドAPIのDebug詳細">
    <strong>API詳細</strong>
    <Fields rows={[
      ['status', value(result.status)], ['isStale', value(result.isStale)],
      ['profileVersion', value(result.profileVersion)], ['exactWeightingVersion', value(result.exactWeightingVersion)],
      ['generateEmbeddings', value(result.generateEmbeddings)], ['detail', value(result.detail)],
      ['Retry-After (秒)', value(result.retryAfterSeconds)],
    ]} />
  </section>
}
export function RecommendationHitDebug({ hit, rank, names }: { hit: RecommendationHit; rank: number; names?: RecommendationTagDisplayName[] }) {
  return <section className="recommendations__debug" aria-label={`候補${rank}のDebug詳細`}>
    <Fields rows={[
      ['API候補順', rank], ['score（一致率ではありません）', value(hit.score)],
      ['titleRank', value(hit.signals?.titleRank)], ['semanticTagRank', value(hit.signals?.semanticTagRank)],
      ['exactTagRank', value(hit.signals?.exactTagRank)],
      ['推薦理由', Array.isArray(hit.reasons) ? hit.reasons.length ? <ul key="reasons">{hit.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : 'なし' : '未提供'],
      ['共通タグ', <Tags key="common" tags={hit.commonTags} names={names} />],
      ...(hit.key?.entityType !== 'Book' ? [
        ['代表タグ', <Tags key="representative" tags={hit.entity?.representativeTags} names={names} />],
        ['totalBookCount', value(hit.entity?.totalBookCount)], ['semanticBookCount', value(hit.entity?.semanticBookCount)],
        ['exactBookCount', value(hit.entity?.exactBookCount)],
      ] as [string, ReactNode][] : []),
    ]} />
    <details>
      <summary>識別子・サムネイルの取得元</summary>
      <Fields rows={[
        ['entityType', value(hit.key?.entityType)], ['groupId', value(hit.key?.groupId)],
        ['bookId', value(hit.key?.bookId)], ['tagName', value(hit.key?.tagName)],
        ...(hit.key?.entityType !== 'Book' ? [
          ['thumbnailBook', hit.entity?.thumbnailBook === null ? 'null' : hit.entity?.thumbnailBook === undefined ? '未提供' : '提供あり'],
          ['thumbnail groupId', value(hit.entity?.thumbnailBook?.groupId)], ['thumbnail bookId', value(hit.entity?.thumbnailBook?.bookId)],
          ['thumbnail uploadedTime', value(hit.entity?.thumbnailBook?.uploadedTime)],
        ] as [string, ReactNode][] : []),
      ]} />
    </details>
  </section>
}
