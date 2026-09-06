import type { ColorTheme } from '../api'

export function applyColorTheme(theme: ColorTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.colorTheme = theme
}
