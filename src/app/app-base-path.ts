/**
 * The application is built with a relative Vite base and the serving nginx
 * may rewrite the document's <base> element for a reverse-proxy prefix.
 * Routes inside the application continue to use logical root-relative paths
 * (for example, `/search`); these helpers translate them to and from the
 * public URL path at runtime.
 */

const ROOT_APP_PATH = '/'
const FALLBACK_ORIGIN = 'http://localhost/'

const isAbsoluteUrl = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')

const getPathname = (value: string) => {
  if (isAbsoluteUrl(value)) {
    try {
      return new URL(value, FALLBACK_ORIGIN).pathname || ROOT_APP_PATH
    } catch {
      return ROOT_APP_PATH
    }
  }
  const queryStart = value.search(/[?#]/)
  return (queryStart < 0 ? value : value.slice(0, queryStart)) || ROOT_APP_PATH
}

const getSuffix = (value: string) => {
  const suffixStart = value.search(/[?#]/)
  return suffixStart < 0 ? '' : value.slice(suffixStart)
}

/** Normalizes a document/app base to a leading-slash path without a suffix. */
export const normalizeAppBasePath = (value?: string | null): string => {
  if (!value) return ROOT_APP_PATH
  let pathname = getPathname(value.trim())
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  pathname = pathname.replace(/\/+/g, '/').replace(/\/+$/, '')
  return pathname || ROOT_APP_PATH
}

const getDocumentBaseURI = () => {
  if (typeof document === 'undefined') return null
  const baseElement = document.querySelector('base[href]')
  const baseURI = typeof document.baseURI === 'string' ? document.baseURI : ''

  // Without a <base>, document.baseURI is normally just the current page URL
  // and must not accidentally turn `/search` into the app base. A distinct
  // explicitly supplied baseURI is still accepted, which keeps this helper
  // easy to exercise in DOM-free tests.
  if (!baseElement) {
    if (!baseURI) return null
    if (typeof window !== 'undefined' && baseURI === window.location.href) return null
    return baseURI
  }
  return baseURI || baseElement.getAttribute('href')
}

/**
 * Resolves the runtime app base from document.baseURI. Root deployment is the
 * safe fallback for SSR, tests without a DOM, and documents without a base.
 */
export const getAppBasePath = (baseURI?: string | null): string => {
  if (baseURI !== undefined) return normalizeAppBasePath(baseURI)
  return normalizeAppBasePath(getDocumentBaseURI())
}

/** Returns true when a path belongs to the public app subtree. */
export const isAppPath = (value: string, basePath = getAppBasePath()): boolean => {
  const pathname = getPathname(value)
  const base = normalizeAppBasePath(basePath)
  return base === ROOT_APP_PATH || pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Adds the runtime app prefix to a logical route path. Existing public paths
 * are returned unchanged, making the operation safe to call repeatedly.
 */
export const addAppBasePath = (value: string, basePath = getAppBasePath()): string => {
  if (!value || value.startsWith('#') || value.startsWith('?') || isAbsoluteUrl(value)) return value
  const base = normalizeAppBasePath(basePath)
  if (base === ROOT_APP_PATH) return value

  const pathname = getPathname(value)
  if (isAppPath(pathname, base)) return value
  const suffix = getSuffix(value)
  const logicalPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  const publicPath = logicalPath === '/'
    ? `${base}/`
    : `${base}${logicalPath}`
  return `${publicPath}${suffix}`
}

/** Removes the runtime app prefix and returns the logical route path. */
export const removeAppBasePath = (value: string, basePath = getAppBasePath()): string => {
  const base = normalizeAppBasePath(basePath)
  if (base === ROOT_APP_PATH || !value) return value || ROOT_APP_PATH
  const pathname = getPathname(value)
  if (!isAppPath(pathname, base)) return value
  const suffix = getSuffix(value)
  const logicalPath = pathname === base ? ROOT_APP_PATH : pathname.slice(base.length) || ROOT_APP_PATH
  return `${logicalPath}${suffix}`
}

/** Public-name aliases used at call sites that make the direction explicit. */
export const toPublicPath = addAppBasePath
export const toLogicalPath = removeAppBasePath

const getCurrentOrigin = () => (
  typeof window !== 'undefined' && typeof window.location?.origin === 'string'
    ? window.location.origin
    : null
)

/**
 * Converts a URL to its public app URL. External origins are left untouched;
 * same-origin logical paths are prefixed exactly once.
 */
export const toPublicUrl = (value: string | URL, basePath = getAppBasePath()): URL => {
  const currentOrigin = getCurrentOrigin()
  const baseHref = typeof window !== 'undefined' && typeof window.location?.href === 'string'
    ? window.location.href
    : `${currentOrigin ?? FALLBACK_ORIGIN}/`
  const url = value instanceof URL ? new URL(value.href) : new URL(value, baseHref)
  if (currentOrigin && url.origin !== currentOrigin) return url
  // Root-relative string inputs are logical app routes. URL objects and
  // absolute strings already describe public destinations and may point to a
  // different app on the same reverse-proxy origin.
  if (typeof value === 'string' && !isAbsoluteUrl(value)) {
    url.pathname = addAppBasePath(url.pathname, basePath)
  }
  return url
}
