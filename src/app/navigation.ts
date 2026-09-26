import { Download, Gauge, Globe2, Library, ListFilter, Search, Shuffle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavigationItem = {
  label: string
  icon: LucideIcon
  href?: string
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: 'ライブラリ',
    items: [
      { label: '検索', icon: Search, href: '/search' },
      { label: 'ランダム', icon: Shuffle, href: '/search/random' },
      { label: 'グループ', icon: Library, href: '/search/grouped' },
      { label: '未タグ検索', icon: ListFilter, href: '/search/missing-tags' },
      { label: 'ステータス検索', icon: ListFilter, href: '/search/status' },
    ],
  },
  {
    label: 'オンライン',
    items: [
      { label: 'Hitomi', icon: Globe2, href: '/hitomila/search' },
      { label: 'Web Cache', icon: ListFilter, href: '/web-cache' },
      { label: 'ダウンロード', icon: Download, href: '/download/book' },
    ],
  },
  {
    label: 'システム',
    items: [
      { label: 'Dashboard', icon: Gauge, href: '/dashboard' },
    ],
  },
]

export const isNavigationItemActive = (item: NavigationItem, currentPath: string) => (
  item.href === '/dashboard'
    ? currentPath === '/dashboard' || currentPath.startsWith('/dashboard/')
    : item.href === currentPath
)
