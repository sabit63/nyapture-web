import { ArrowLeft, Menu, X } from 'lucide-react'
import { type ReactNode, type RefObject } from 'react'

import nyaIcon from '../assets/icon.png'
import { Button, buttonClassName } from '../components/ui/Button'
import { IconButton } from '../components/ui/IconButton'
import { isNavigationItemActive, navigationGroups } from './navigation'
import { InternalLink } from './client-router'

export type AppShellProps = {
  currentPath: string
  drawerOpen: boolean
  onOpenDrawer: () => void
  onCloseDrawer: () => void
  onNavigate: () => void
  onBack?: () => void
  menuButtonRef: RefObject<HTMLButtonElement | null>
  headerCenter: ReactNode
  headerActions: ReactNode
  children: ReactNode
}

export function AppShell({
  currentPath,
  drawerOpen,
  onOpenDrawer,
  onCloseDrawer,
  onNavigate,
  onBack,
  menuButtonRef,
  headerCenter,
  headerActions,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">本文へ移動</a>

      <header className="topbar">
        <div className="topbar__brand">
          <IconButton
            ref={menuButtonRef}
            className="menu-button"
            variant="ghost"
            tone="neutral"
            aria-label="ナビゲーションを開く"
            aria-expanded={drawerOpen}
            aria-controls="primary-navigation"
            onClick={onOpenDrawer}
          >
            <Menu size={20} aria-hidden="true" />
          </IconButton>
          {onBack ? (
            <IconButton
              className="header-back-button"
              variant="ghost"
              tone="neutral"
              aria-label="戻る"
              onClick={onBack}
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </IconButton>
          ) : (
            <InternalLink className="brand" href="/search" aria-label="Nyapture ホーム">
              <span className="brand__mark"><img className="brand__image" src={nyaIcon} alt="" /></span>
              <span className="brand__name">Nyapture</span>
            </InternalLink>
          )}
        </div>

        {headerCenter}

        <div className="topbar__actions">
          {headerActions}
        </div>
      </header>

      <Button
        className="drawer-scrim"
        variant="ghost"
        tone="neutral"
        size="compact"
        aria-label="ナビゲーションを閉じる"
        onClick={onCloseDrawer}
      />

      <aside id="primary-navigation" className={`drawer ${drawerOpen ? 'drawer--open' : ''}`} aria-label="メインナビゲーション">
        <div className="drawer__mobile-head">
          <span className="brand__mark"><img className="brand__image" src={nyaIcon} alt="" /></span>
          <span>Nyapture</span>
          <IconButton variant="ghost" tone="neutral" aria-label="ナビゲーションを閉じる" onClick={onCloseDrawer}>
            <X size={19} aria-hidden="true" />
          </IconButton>
        </div>
        <nav>
          {navigationGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const itemIsActive = isNavigationItemActive(item, currentPath)
                  return (
                    <li key={item.label}>
                      {item.href ? (
                        <InternalLink
                          href={item.href}
                          className={buttonClassName(
                            { variant: 'ghost', tone: 'neutral', size: 'default' },
                            `nav-item ${itemIsActive ? 'nav-item--active' : ''}`,
                          )}
                          aria-current={itemIsActive ? 'page' : undefined}
                          onClick={onNavigate}
                        >
                          <Icon size={18} />
                          <span>{item.label}</span>
                        </InternalLink>
                      ) : (
                        <Button
                          className="nav-item"
                          variant="ghost"
                          tone="neutral"
                          size="default"
                          aria-label={`${item.label}（準備中）`}
                          disabled
                        >
                          <Icon size={18} />
                          <span>{item.label}</span>
                          <span className="nav-item__soon">Soon</span>
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main id="main-content" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
