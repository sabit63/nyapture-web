import { useEffect, useRef, useState } from 'react'

export function useAppShellController() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  useEffect(() => {
    document.body.classList.toggle('drawer-open', drawerOpen)
    return () => document.body.classList.remove('drawer-open')
  }, [drawerOpen])

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 880px)')
    const closeOverlayDrawer = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false)
    }
    desktopQuery.addEventListener('change', closeOverlayDrawer)
    return () => desktopQuery.removeEventListener('change', closeOverlayDrawer)
  }, [])

  const closeDrawer = () => {
    setDrawerOpen(false)
    menuButtonRef.current?.focus()
  }

  return {
    drawerOpen,
    menuButtonRef,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer,
    onNavigate: () => setDrawerOpen(false),
  }
}
