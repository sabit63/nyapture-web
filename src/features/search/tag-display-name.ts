import type { BookTag, TagEntity } from '../../models'
import { sameTag } from './search-utils'

export type TagDisplayNameOverrides = ReadonlyMap<string, string | undefined>

export const getTagDisplayNameKey = (tag: Pick<BookTag, 'type' | 'name'>) => (
  `${tag.type}\u0000${tag.name.toLocaleLowerCase()}`
)

export const withTagDisplayName = <T extends { displayName?: string }>(
  tag: T,
  displayName?: string,
): T => {
  if (displayName === undefined) {
    const { displayName: _displayName, ...withoutDisplayName } = tag
    return withoutDisplayName as T
  }
  return tag.displayName === displayName ? tag : { ...tag, displayName }
}

export const updateTagDisplayNames = <T extends {
  type?: BookTag['type']
  name?: string
  displayName?: string
}>(
  tags: T[],
  target: BookTag,
  displayName?: string,
): T[] => {
  let changed = false
  const next = tags.map((tag) => {
    if (tag.type === undefined || tag.name === undefined || !sameTag(tag as BookTag, target)) return tag
    const updated = withTagDisplayName(tag, displayName)
    changed = changed || updated !== tag
    return updated
  })
  return changed ? next : tags
}

export const applyTagDisplayNameOverrides = (
  tags: BookTag[],
  overrides: TagDisplayNameOverrides,
): BookTag[] => {
  if (overrides.size === 0) return tags
  let changed = false
  const next = tags.map((tag) => {
    const key = getTagDisplayNameKey(tag)
    if (!overrides.has(key)) return tag
    const updated = withTagDisplayName(tag, overrides.get(key))
    changed = changed || updated !== tag
    return updated
  })
  return changed ? next : tags
}

export const applyTagEntityMetadata = (
  tags: BookTag[],
  entities: TagEntity[],
): BookTag[] => {
  if (entities.length === 0) return tags
  let changed = false
  const next = tags.map((tag) => {
    const entity = entities.find((candidate) => (
      candidate.type !== undefined
      && candidate.name !== undefined
      && sameTag(candidate as BookTag, tag)
    ))
    const displayName = entity?.displayName?.trim()
    const count = entity?.count
    const displayNameChanged = Boolean(displayName) && displayName !== tag.displayName
    const countChanged = typeof count === 'number' && count !== tag.count
    if (!displayNameChanged && !countChanged) return tag
    changed = true
    return {
      ...tag,
      ...(displayName ? { displayName } : {}),
      ...(typeof count === 'number' ? { count } : {}),
    }
  })
  return changed ? next : tags
}
