import { getTagAdditionalName } from '../../api'
import type { BookTag, TagEntity } from '../../models'
import { sameTag } from './search-utils'

/** URL criteria contain canonical names only; web results may omit their metadata. */
export async function resolveSearchTags(
  tags: BookTag[],
  entities: TagEntity[],
  signal: AbortSignal,
): Promise<TagEntity[]> {
  const missing = tags.filter((tag, index) => (
    tags.findIndex((candidate) => sameTag(candidate, tag)) === index
    && !entities.some((entity) => entity.type && entity.name
      && sameTag(entity as BookTag, tag) && entity.displayName?.trim())
  ))
  const resolved = await Promise.all(missing.map(async (tag): Promise<TagEntity | undefined> => {
    try {
      const record = await getTagAdditionalName(tag.type, tag.name, signal)
      const displayName = record.primaryAdditionalName?.trim()
      if (record.status !== 'Approved' || !displayName) return undefined
      return { type: tag.type, name: tag.name, displayName }
    } catch {
      // Optional labels must not turn an otherwise successful search into an error.
      return undefined
    }
  }))
  if (signal.aborted) return entities
  const next = [...entities]
  for (const entity of resolved) {
    if (!entity) continue
    const index = next.findIndex((candidate) => candidate.type && candidate.name
      && sameTag(candidate as BookTag, entity as BookTag))
    if (index < 0) next.push(entity)
    else next[index] = { ...next[index], ...entity }
  }
  return next
}
