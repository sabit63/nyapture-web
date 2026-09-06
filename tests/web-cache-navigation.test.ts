import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNavigationItemActive, navigationGroups } from '../src/app/navigation'

test('Web Cache management belongs to Dashboard without a separate sidebar entry', () => {
  const items = navigationGroups.flatMap((group) => group.items)
  assert.equal(items.some((item) => item.href === '/dashboard/web-cache'), false)
  for (const [path, label] of [['/web-cache', 'Web Cache'], ['/dashboard/web-cache', 'Dashboard'], ['/dashboard/cache', 'Dashboard']]) {
    assert.deepEqual(items.filter((item) => isNavigationItemActive(item, path)).map((item) => item.label), [label])
  }
})
