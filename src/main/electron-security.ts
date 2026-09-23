import type { BrowserWindow, Session, WebPreferences } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export type RuntimeSecurityOptions = {
  appRoot: string
  isPackaged: boolean
  openExternal: (url: string) => Promise<void>
}

export function getSecureWebPreferences(isPackaged: boolean): WebPreferences {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    devTools: !isPackaged,
  }
}

function getProductionRendererUrl(appRoot: string) {
  return pathToFileURL(
    path.join(appRoot, 'dist', 'renderer', 'index.html'),
  ).toString()
}

export function isTrustedRendererUrl(
  rawUrl: string,
  options: Pick<RuntimeSecurityOptions, 'appRoot' | 'isPackaged'>,
): boolean {
  try {
    const url = new URL(rawUrl)

    if (!options.isPackaged) {
      return (
        url.protocol === 'http:' &&
        url.hostname === 'localhost' &&
        url.port === '3000' &&
        url.pathname === '/' &&
        url.search === ''
      )
    }

    if (url.search) {
      return false
    }

    url.hash = ''

    return url.toString() === getProductionRendererUrl(options.appRoot)
  } catch {
    return false
  }
}

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    if (url.protocol === 'tel:') {
      return (
        url.search === '' &&
        url.hash === '' &&
        /^\+?\d{7,15}$/.test(url.pathname)
      )
    }

    if (url.protocol !== 'https:') {
      return false
    }

    return (
      url.hostname === 'wa.me' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      /^\/\d{7,15}$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

function getRequestingUrl(details: unknown): string {
  if (
    !details ||
    typeof details !== 'object' ||
    !('requestingUrl' in details)
  ) {
    return ''
  }

  const requestingUrl = (details as { requestingUrl?: unknown }).requestingUrl

  return typeof requestingUrl === 'string' ? requestingUrl : ''
}

export function isAllowedPermission(
  permission: string,
  requestingUrl: string,
  options: Pick<RuntimeSecurityOptions, 'appRoot' | 'isPackaged'>,
): boolean {
  return (
    permission === 'clipboard-sanitized-write' &&
    isTrustedRendererUrl(requestingUrl, options)
  )
}

export function configureSessionPermissions(
  electronSession: Session,
  options: RuntimeSecurityOptions,
): void {
  electronSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(
        isAllowedPermission(permission, getRequestingUrl(details), options),
      )
    },
  )

  electronSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      const requestingUrl =
        getRequestingUrl(details) || String(requestingOrigin || '')

      return isAllowedPermission(permission, requestingUrl, options)
    },
  )
}

export function hardenAuxiliaryWindow(window: BrowserWindow): void {
  window.setMenu(null)
  window.setMenuBarVisibility(false)

  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }))

  window.webContents.on('will-frame-navigate', (event) => {
    event.preventDefault()
  })

  window.webContents.on('will-redirect', (event) => {
    event.preventDefault()
  })
}

export function configureMainWindowSecurity(
  window: BrowserWindow,
  options: RuntimeSecurityOptions,
): void {
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, options)) {
      event.preventDefault()
    }
  })

  window.webContents.on('will-redirect', (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, options)) {
      event.preventDefault()
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: getSecureWebPreferences(options.isPackaged),
        },
      }
    }

    if (isAllowedExternalUrl(url)) {
      void options.openExternal(url).catch((error) => {
        console.error('Failed to open external URL:', error)
      })
    }

    return {
      action: 'deny',
    }
  })

  window.webContents.on('did-create-window', (childWindow) => {
    hardenAuxiliaryWindow(childWindow)
  })
}
