import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNavigationItemActive, navigationGroups } from '../src/app/navigation'

test('Web Cache routes each activate a single navigation entry', () => {
  const items = navigationGroups.flatMap((group) => group.items)
  for (const [path, label] of [['/web-cache', 'キャッシュ候補'], ['/dashboard/web-cache', 'Web Cache'], ['/dashboard/cache', 'Dashboard']]) {
    assert.deepEqual(items.filter((item) => isNavigationItemActive(item, path)).map((item) => item.label), [label])
  }
})
