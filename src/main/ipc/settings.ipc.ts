import { BrowserWindow, app, dialog, ipcMain, nativeImage } from 'electron'
import type {
  IpcMainInvokeEvent,
  OpenDialogOptions,
  SaveDialogOptions,
} from 'electron'
import {
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
} from '../auth-session'
import { logAction } from './activity-helper'
import fs from 'node:fs'
import path from 'node:path'
import {
  getBarcodePrintSettings,
  getLoyaltySettings,
  saveBarcodePrintSettings,
  saveLoyaltySettings,
  getAppLicenseStatus,
  activateApp,
  saveAppLogoUrl,
  deactivateApp,
  saveAppName,
  saveStoreContactInfo,
  saveStoreQrSettings,
  getReceiptPrintSettings,
  saveReceiptPrintSettings,
  saveAppTheme,
} from '../database/repositories/settings.repo'
import { closeDb, getDb, getDbPath, resetDatabaseData } from '../database/db'
import {
  createAutoBackup,
  getAutoBackupInfo,
  setAutoBackupDir,
} from '../database/auto-backup'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'حدث خطأ غير متوقع'
}

function getDefaultBackupName() {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('-')

  return `erp-backup-${stamp}.db`
}

function getImageMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.png') return 'image/png'

  return 'image/png'
}

function updateOpenWindowsIcon(logoUrl: string) {
  if (!logoUrl.startsWith('data:image')) return

  const image = nativeImage.createFromDataURL(logoUrl)

  if (image.isEmpty()) return

  const appIcon = image.resize({
    width: 256,
    height: 256,
    quality: 'best',
  })

  BrowserWindow.getAllWindows().forEach((window) => {
    window.setIcon(appIcon)
  })
}

function recheckAdmin(event: IpcMainInvokeEvent, actorId: number) {
  if (requireAuthenticatedAdmin(event) !== actorId) {
    throw new Error('تغيّر المستخدم أثناء العملية، ابدأ العملية من جديد')
  }
}

function getOptionalActorId(event: IpcMainInvokeEvent): number | null {
  try {
    return requireAuthenticatedUser(event).id
  } catch {
    return null
  }
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-barcode-print', () => {
    return getBarcodePrintSettings()
  })

  ipcMain.handle('settings:save-barcode-print', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const result = saveBarcodePrintSettings(input)

    logAction({
      actor_id: actorId,
      action: 'barcode_print_settings_saved',
      entity: 'settings',
      entity_id: null,
      details: {
        description: 'تم تحديث إعدادات طباعة الباركود',
      },
    })

    return result
  })

  ipcMain.handle('settings:get-receipt-print', () => {
    return getReceiptPrintSettings()
  })

  ipcMain.handle('settings:save-receipt-print', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const result = saveReceiptPrintSettings(input)

    logAction({
      actor_id: actorId,
      action: 'receipt_print_settings_saved',
      entity: 'settings',
      entity_id: null,
      details: {
        description: 'تم تحديث إعدادات طباعة الفاتورة',
      },
    })

    return result
  })

  ipcMain.handle('settings:get-loyalty', () => {
    return getLoyaltySettings()
  })

  ipcMain.handle('settings:save-loyalty', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const result = saveLoyaltySettings(input)

    logAction({
      actor_id: actorId,
      action: 'loyalty_settings_saved',
      entity: 'settings',
      entity_id: null,
      details: {
        description: 'تم تحديث إعدادات نقاط الولاء',
      },
    })

    return result
  })

  ipcMain.handle(
    'settings:backup-database',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)
        const parentWindow = BrowserWindow.fromWebContents(event.sender)

        const options: SaveDialogOptions = {
          title: 'حفظ نسخة احتياطية',
          defaultPath: path.join(
            app.getPath('documents'),
            getDefaultBackupName(),
          ),
          filters: [
            { name: 'SQLite Database', extensions: ['db'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        }

        const result = parentWindow
          ? await dialog.showSaveDialog(parentWindow, options)
          : await dialog.showSaveDialog(options)

        if (result.canceled || !result.filePath) {
          return {
            success: false,
            canceled: true,
            message: 'تم إلغاء حفظ النسخة الاحتياطية',
          }
        }

        recheckAdmin(event, actorId)

        const db = getDb()

        await db.backup(result.filePath)

        logAction({
          actor_id: actorId,
          action: 'database_backup_created',
          entity: 'settings',
          entity_id: null,
          details: {
            path: result.filePath,
          },
        })

        return {
          success: true,
          path: result.filePath,
          message: 'تم حفظ النسخة الاحتياطية بنجاح',
        }
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle(
    'settings:restore-database',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)
        const parentWindow = BrowserWindow.fromWebContents(event.sender)

        const options: OpenDialogOptions = {
          title: 'اختيار نسخة احتياطية للاسترجاع',
          properties: ['openFile'],
          filters: [
            { name: 'SQLite Database', extensions: ['db'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        }

        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, options)
          : await dialog.showOpenDialog(options)

        if (result.canceled || !result.filePaths[0]) {
          return {
            success: false,
            canceled: true,
            message: 'تم إلغاء استرجاع النسخة الاحتياطية',
          }
        }

        const selectedFile = result.filePaths[0]
        const targetDbPath = getDbPath()
        const backupBeforeRestorePath = `${targetDbPath}.before-restore-${Date.now()}.bak`

        recheckAdmin(event, actorId)
        closeDb()

        if (fs.existsSync(targetDbPath)) {
          fs.copyFileSync(targetDbPath, backupBeforeRestorePath)
        }

        fs.copyFileSync(selectedFile, targetDbPath)

        getDb()

        logAction({
          actor_id: actorId,
          action: 'database_restored',
          entity: 'settings',
          entity_id: null,
          details: {
            restored_from: selectedFile,
            safety_backup: backupBeforeRestorePath,
          },
        })

        return {
          success: true,
          path: selectedFile,
          safetyBackupPath: backupBeforeRestorePath,
          message: 'تم استرجاع النسخة الاحتياطية بنجاح',
        }
      } catch (error) {
        try {
          getDb()
        } catch {
          // Ignore reopen errors here; the original error is more useful.
        }

        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle(
    'settings:reset-database',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)
        const parentWindow = BrowserWindow.fromWebContents(event.sender)
        const saveResult = parentWindow
          ? await dialog.showSaveDialog(parentWindow, {
              title: 'اختيار مكان حفظ نسخة الأمان قبل التصفير',
              defaultPath: path.join(
                app.getPath('documents'),
                getDefaultBackupName(),
              ),
              filters: [
                { name: 'SQLite Database', extensions: ['db'] },
                { name: 'Backup Files', extensions: ['bak'] },
                { name: 'All Files', extensions: ['*'] },
              ],
            })
          : await dialog.showSaveDialog({
              title: 'اختيار مكان حفظ نسخة الأمان قبل التصفير',
              defaultPath: path.join(
                app.getPath('documents'),
                getDefaultBackupName(),
              ),
              filters: [
                { name: 'SQLite Database', extensions: ['db'] },
                { name: 'Backup Files', extensions: ['bak'] },
                { name: 'All Files', extensions: ['*'] },
              ],
            })

        if (saveResult.canceled || !saveResult.filePath) {
          return {
            success: false,
            canceled: true,
            message: 'تم إلغاء التصفير لأنك لم تختر مكان حفظ نسخة الأمان',
          }
        }

        recheckAdmin(event, actorId)

        const safetyBackupPath = saveResult.filePath
        const confirmResult = parentWindow
          ? await dialog.showMessageBox(parentWindow, {
              type: 'warning',
              buttons: ['إلغاء', 'تصفير البرنامج'],
              defaultId: 0,
              cancelId: 0,
              title: 'تصفير البرنامج',
              message: 'هل أنت متأكد من تصفير البرنامج؟',
              detail:
                'سيتم مسح كل المنتجات والمبيعات والفواتير والعملاء والموردين وحركات المخزون. سيتم إنشاء نسخة أمان قبل المسح.',
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['إلغاء', 'تصفير البرنامج'],
              defaultId: 0,
              cancelId: 0,
              title: 'تصفير البرنامج',
              message: 'هل أنت متأكد من تصفير البرنامج؟',
              detail:
                'سيتم مسح كل المنتجات والمبيعات والفواتير والعملاء والموردين وحركات المخزون. سيتم إنشاء نسخة أمان قبل المسح.',
            })

        if (confirmResult.response !== 1) {
          return {
            success: false,
            canceled: true,
            message: 'تم إلغاء تصفير البرنامج',
          }
        }

        recheckAdmin(event, actorId)

        const db = getDb()

        await db.backup(safetyBackupPath)

        recheckAdmin(event, actorId)

        resetDatabaseData()

        logAction({
          actor_id: actorId,
          action: 'database_reset',
          entity: 'settings',
          entity_id: null,
          details: {
            safety_backup: safetyBackupPath,
          },
        })

        return {
          success: true,
          safetyBackupPath,
          message: 'تم تصفير البرنامج بنجاح',
        }
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle('settings:get-auto-backup-info', (event) => {
    requireAuthenticatedAdmin(event)
    return getAutoBackupInfo()
  })

  ipcMain.handle(
    'settings:choose-auto-backup-dir',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const parentWindow = BrowserWindow.fromWebContents(event.sender)

        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, {
              title: 'اختيار مكان النسخ التلقائي',
              properties: ['openDirectory', 'createDirectory'],
            })
          : await dialog.showOpenDialog({
              title: 'اختيار مكان النسخ التلقائي',
              properties: ['openDirectory', 'createDirectory'],
            })

        if (result.canceled || !result.filePaths[0]) {
          return {
            success: false,
            canceled: true,
          }
        }

        recheckAdmin(event, actorId)
        setAutoBackupDir(result.filePaths[0])
        const backup = await createAutoBackup('manual')
        const info = backup.info || getAutoBackupInfo()

        logAction({
          actor_id: actorId,
          action: 'auto_backup_dir_changed',
          entity: 'settings',
          entity_id: null,
          details: {
            path: result.filePaths[0],
            backup,
          },
        })

        return {
          success: true,
          info,
          backup,
          message: 'تم اختيار مكان النسخ التلقائي بنجاح',
        }
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle(
    'settings:run-auto-backup-now',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const result = await createAutoBackup('manual')

        logAction({
          actor_id: actorId,
          action: 'auto_backup_run_now',
          entity: 'settings',
          entity_id: null,
          details: result,
        })

        return result
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle('settings:get-license-status', () => {
    return getAppLicenseStatus()
  })

  ipcMain.handle('settings:activate-app', (event, code: string) => {
    const result = activateApp(code)

    if (result?.success !== false) {
      logAction({
        actor_id: getOptionalActorId(event),
        action: 'app_activated',
        entity: 'settings',
        entity_id: null,
        details: {
          description: 'تم تفعيل البرنامج',
        },
      })
    }

    return result
  })

  ipcMain.handle('settings:deactivate-app', (event) => {
    const actorId = getOptionalActorId(event)

    const result = deactivateApp()

    if (result?.success !== false) {
      logAction({
        actor_id: actorId,
        action: 'app_deactivated',
        entity: 'settings',
        entity_id: null,
        details: {
          description: 'تم إلغاء تفعيل البرنامج',
        },
      })
    }

    return result
  })

  ipcMain.handle(
    'settings:save-app-logo-url',
    (event, url: string, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const saved = saveAppLogoUrl(url)

        if (String(url || '').startsWith('data:image')) {
          updateOpenWindowsIcon(url)
        }

        logAction({
          actor_id: actorId,
          action: 'app_logo_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            has_logo: Boolean(String(url || '').trim()),
          },
        })
        return saved
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle('settings:choose-app-logo', async (event) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)
      const parentWindow = BrowserWindow.fromWebContents(event.sender)

      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, {
            title: 'اختيار صورة التطبيق',
            properties: ['openFile'],
            filters: [
              { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
            ],
          })
        : await dialog.showOpenDialog({
            title: 'اختيار صورة التطبيق',
            properties: ['openFile'],
            filters: [
              { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
            ],
          })

      if (result.canceled || !result.filePaths[0]) {
        return {
          success: false,
          canceled: true,
        }
      }

      const selectedPath = result.filePaths[0]
      const mimeType = getImageMimeType(selectedPath)
      const buffer = fs.readFileSync(selectedPath)

      const logoUrl = `data:${mimeType};base64,${buffer.toString('base64')}`

      const saved = saveAppLogoUrl(logoUrl)
      updateOpenWindowsIcon(logoUrl)
      logAction({
        actor_id: actorId,
        action: 'app_logo_saved',
        entity: 'settings',
        entity_id: null,
        details: {
          file_name: path.basename(selectedPath),
          has_logo: true,
        },
      })

      return {
        success: true,
        logoUrl,
        status: saved.status,
      }
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle(
    'settings:save-app-name',
    (event, name: string, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const saved = saveAppName(name)

        BrowserWindow.getAllWindows().forEach((window) => {
          window.setTitle(saved.status.app_name || 'ERP Store')
        })
        logAction({
          actor_id: actorId,
          action: 'app_name_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            name: saved.status.app_name,
          },
        })
        return saved
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle(
    'settings:save-store-contact-info',
    (event, phone: string, address: string, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const saved = saveStoreContactInfo(phone, address)

        logAction({
          actor_id: actorId,
          action: 'store_contact_info_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            phone,
            address,
          },
        })

        return saved
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle('settings:save-store-qr-settings', (event, input?: any) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      const payload = {
        store_qr_enabled: Boolean(input?.store_qr_enabled),

        store_qr_title: String(input?.store_qr_title || '').trim(),

        store_qr_primary_url: String(input?.store_qr_primary_url || '').trim(),
      }

      const saved = saveStoreQrSettings(payload)

      logAction({
        actor_id: actorId,
        action: 'store_qr_settings_saved',
        entity: 'settings',
        entity_id: null,
        details: payload,
      })

      return saved
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle(
    'settings:save-app-theme',
    (event, theme: 'dark' | 'light', input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedUser(event).id

        const saved = saveAppTheme(theme)

        logAction({
          actor_id: actorId,
          action: 'app_theme_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            theme,
          },
        })

        return saved
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        }
      }
    },
  )
}
