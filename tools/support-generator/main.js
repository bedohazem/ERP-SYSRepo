const { app, BrowserWindow, dialog, ipcMain, session } = require('electron')

const fs = require('node:fs')

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const crypto = require('node:crypto')

let mainWindow = null
const supportIndexPath = path.join(__dirname, 'index.html')

function isTrustedSupportUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)

    if (url.search) {
      return false
    }

    url.hash = ''

    return url.toString() === pathToFileURL(supportIndexPath).toString()
  } catch {
    return false
  }
}

function configureSupportPermissions() {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(
        permission === 'clipboard-sanitized-write' &&
          isTrustedSupportUrl(details?.requestingUrl || ''),
      )
    },
  )

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      const requestingUrl = details?.requestingUrl || requestingOrigin || ''

      return (
        permission === 'clipboard-sanitized-write' &&
        isTrustedSupportUrl(requestingUrl)
      )
    },
  )
}

function hardenSupportWindow(window) {
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

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function formatCode(value) {
  return (
    normalizeCode(value)
      .match(/.{1,4}/g)
      ?.join('-') || normalizeCode(value)
  )
}

function loadPrivateKey(privateKeyPath) {
  if (!privateKeyPath || !fs.existsSync(privateKeyPath)) {
    throw new Error('اختر ملف Private Key أولًا')
  }

  const key = crypto.createPrivateKey(fs.readFileSync(privateKeyPath, 'utf8'))

  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('الـPrivate Key ليس Ed25519')
  }

  return key
}

function signToken(prefix, payload, privateKey) {
  const buffer = Buffer.from(JSON.stringify(payload), 'utf8')

  const signature = crypto.sign(null, buffer, privateKey)

  return [
    prefix,

    buffer.toString('base64url'),

    signature.toString('base64url'),
  ].join('.')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,

    minWidth: 820,
    minHeight: 650,

    title: 'ERP Support Generator',

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),

      contextIsolation: true,

      nodeIntegration: false,

      sandbox: true,

      webviewTag: false,

      webSecurity: true,

      allowRunningInsecureContent: false,

      devTools: !app.isPackaged,
    },
  })

  hardenSupportWindow(mainWindow)

  mainWindow.removeMenu()

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
}

ipcMain.handle('support:choose-private-key', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'اختيار Support Private Key',

    properties: ['openFile'],

    filters: [
      {
        name: 'PEM Private Key',

        extensions: ['pem'],
      },
    ],
  })

  if (result.canceled || !result.filePaths[0]) {
    return {
      canceled: true,
    }
  }

  const filePath = result.filePaths[0]

  /*
   * نتحقق منه فور الاختيار.
   */
  loadPrivateKey(filePath)

  return {
    canceled: false,

    path: filePath,

    name: path.basename(filePath),
  }
})

ipcMain.handle('support:generate-activation', (_event, input) => {
  try {
    const privateKey = loadPrivateKey(input?.private_key_path)

    const deviceCode = normalizeCode(input?.device_code)

    if (!deviceCode) {
      throw new Error('اكتب Device Code')
    }

    const issuedAt = Math.floor(Date.now() / 1000)

    const payload = {
      v: 1,

      purpose: 'app_activation',

      device_code: deviceCode,

      license_id: crypto.randomUUID(),

      issued_at: issuedAt,

      /*
       * Lifetime license حاليًا.
       */
      expires_at: null,
    }

    const token = signToken('ERPA1', payload, privateKey)

    return {
      success: true,

      token,

      license_id: payload.license_id,

      device_code: formatCode(deviceCode),

      issued_at: new Date(issuedAt * 1000).toISOString(),
    }
  } catch (error) {
    return {
      success: false,

      message:
        error instanceof Error ? error.message : 'تعذر إنشاء كود التفعيل',
    }
  }
})

ipcMain.handle('support:generate-recovery', (_event, input) => {
  try {
    const privateKey = loadPrivateKey(input?.private_key_path)

    const deviceCode = normalizeCode(input?.device_code)

    const requestId = normalizeCode(input?.request_id)

    const username = String(input?.username || '').trim()

    const minutes = Number(input?.minutes || 15)

    if (!deviceCode || !requestId || !username) {
      throw new Error('Device Code و Request ID و Username مطلوبة')
    }

    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 15) {
      throw new Error('صلاحية Recovery Code من 1 إلى 15 دقيقة')
    }

    const issuedAt = Math.floor(Date.now() / 1000)

    const expiresAt = issuedAt + Math.floor(minutes * 60)

    const payload = {
      v: 1,

      purpose: 'admin_password_recovery',

      device_code: deviceCode,

      request_id: requestId,

      username,

      issued_at: issuedAt,

      expires_at: expiresAt,
    }

    const token = signToken('ERPR1', payload, privateKey)

    return {
      success: true,

      token,

      device_code: formatCode(deviceCode),

      request_id: formatCode(requestId),

      username,

      expires_at: new Date(expiresAt * 1000).toISOString(),
    }
  } catch (error) {
    return {
      success: false,

      message:
        error instanceof Error ? error.message : 'تعذر إنشاء Recovery Code',
    }
  }
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }

    mainWindow.focus()
  })

  app.whenReady().then(() => {
    configureSupportPermissions()
    createWindow()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
