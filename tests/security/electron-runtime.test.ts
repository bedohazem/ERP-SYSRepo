import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  getSecureWebPreferences,
  isAllowedExternalUrl,
  isAllowedPermission,
  isTrustedRendererUrl,
  configureMainWindowSecurity,
  clampWindowDimension,
  type RuntimeSecurityOptions,
} from '../../src/main/electron-security'

const devOptions: RuntimeSecurityOptions = {
  appRoot: process.cwd(),
  isPackaged: false,
  openExternal: async () => {},
}

const productionAppRoot = path.join(process.cwd(), 'electron-runtime-test-app')

const productionOptions: RuntimeSecurityOptions = {
  appRoot: productionAppRoot,
  isPackaged: true,
  openExternal: async () => {},
}

describe('Electron runtime security policy', () => {
  it('only trusts the expected renderer document', () => {
    expect(
      isTrustedRendererUrl('http://localhost:3000/#/dashboard', devOptions),
    ).toBe(true)

    expect(
      isTrustedRendererUrl('http://127.0.0.1:3000/#/dashboard', devOptions),
    ).toBe(false)

    expect(isTrustedRendererUrl('https://example.com', devOptions)).toBe(false)

    const productionUrl = pathToFileURL(
      path.join(productionAppRoot, 'dist', 'renderer', 'index.html'),
    ).toString()

    expect(
      isTrustedRendererUrl(`${productionUrl}#/settings`, productionOptions),
    ).toBe(true)

    expect(
      isTrustedRendererUrl(`${productionUrl}?unexpected=1`, productionOptions),
    ).toBe(false)

    expect(
      isTrustedRendererUrl(
        pathToFileURL(path.join(productionAppRoot, 'other.html')).toString(),
        productionOptions,
      ),
    ).toBe(false)
  })

  it('only allows explicitly approved external support URLs', () => {
    expect(isAllowedExternalUrl('tel:01155559287')).toBe(true)

    expect(isAllowedExternalUrl('https://wa.me/201155559287')).toBe(true)

    expect(
      isAllowedExternalUrl('https://wa.me/201155559287?text=unexpected'),
    ).toBe(false)

    expect(isAllowedExternalUrl('https://example.com')).toBe(false)

    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)

    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(
      false,
    )
  })

  it('only grants clipboard write to the trusted renderer', () => {
    expect(
      isAllowedPermission(
        'clipboard-sanitized-write',
        'http://localhost:3000/#/settings',
        devOptions,
      ),
    ).toBe(true)

    expect(
      isAllowedPermission(
        'clipboard-read',
        'http://localhost:3000/#/settings',
        devOptions,
      ),
    ).toBe(false)

    expect(
      isAllowedPermission(
        'openExternal',
        'http://localhost:3000/#/settings',
        devOptions,
      ),
    ).toBe(false)

    expect(
      isAllowedPermission(
        'clipboard-sanitized-write',
        'https://example.com',
        devOptions,
      ),
    ).toBe(false)
  })

  it('denies renderer popups and only forwards allowed external URLs', () => {
    let windowOpenHandler: any = null

    const openedExternalUrls: string[] = []

    const fakeWindow = {
      webContents: {
        on: () => undefined,

        setWindowOpenHandler: (handler: any) => {
          windowOpenHandler = handler
        },
      },
    } as any

    configureMainWindowSecurity(fakeWindow, {
      ...devOptions,

      openExternal: async (url) => {
        openedExternalUrls.push(url)
      },
    })

    expect(windowOpenHandler).not.toBeNull()

    expect(
      windowOpenHandler({
        url: 'about:blank',
      }),
    ).toEqual({
      action: 'deny',
    })

    expect(
      windowOpenHandler({
        url: 'https://example.com',
      }),
    ).toEqual({
      action: 'deny',
    })

    expect(
      windowOpenHandler({
        url: 'https://wa.me/201155559287',
      }),
    ).toEqual({
      action: 'deny',
    })

    expect(openedExternalUrls).toEqual(['https://wa.me/201155559287'])
  })

  it('normalizes preview window dimensions safely', () => {
    expect(clampWindowDimension(undefined, 1000, 420, 1400)).toBe(1000)

    expect(clampWindowDimension(Number.NaN, 1000, 420, 1400)).toBe(1000)

    expect(clampWindowDimension(200, 1000, 420, 1400)).toBe(420)

    expect(clampWindowDimension(5000, 1000, 420, 1400)).toBe(1400)

    expect(clampWindowDimension(999.6, 1000, 420, 1400)).toBe(1000)
  })

  it('enforces hardened BrowserWindow defaults', () => {
    expect(getSecureWebPreferences(true)).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
    })

    expect(getSecureWebPreferences(false).devTools).toBe(true)
  })
})
