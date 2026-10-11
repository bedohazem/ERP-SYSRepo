import { BrowserWindow, app, dialog, ipcMain, nativeImage } from 'electron';
import type {
  IpcMainInvokeEvent,
  OpenDialogOptions,
  SaveDialogOptions,
} from 'electron';
import {
  clearAuthSession,
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
} from '../auth-session';
import { logAction, runCriticalActionWithAudit } from './activity-helper';
import fs from 'node:fs';
import path from 'node:path';
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
} from '../database/repositories/settings.repo';
import { getDb, resetDatabaseData } from '../database/db';
import {
  createAutoBackup,
  getAutoBackupInfo,
  setAutoBackupDir,
} from '../database/auto-backup';

import {
  createVerifiedDatabaseBackup,
  restoreVerifiedDatabase,
} from '../database/database-backup';
import { validateErpDatabaseFile } from '../database/backup-integrity';
import {
  optionalBooleanValue,
  requireEnumValue,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveMoney,
} from './input-validation';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'حدث خطأ غير متوقع';
}

function getDefaultBackupName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('-');

  return `erp-backup-${stamp}.db`;
}

function getImageMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';

  return 'image/png';
}

function updateOpenWindowsIcon(logoUrl: string) {
  if (!logoUrl.startsWith('data:image')) return;

  const image = nativeImage.createFromDataURL(logoUrl);

  if (image.isEmpty()) return;

  const appIcon = image.resize({
    width: 256,
    height: 256,
    quality: 'best',
  });

  BrowserWindow.getAllWindows().forEach((window) => {
    window.setIcon(appIcon);
  });
}

function recheckAdmin(event: IpcMainInvokeEvent, actorId: number) {
  if (requireAuthenticatedAdmin(event) !== actorId) {
    throw new Error('تغيّر المستخدم أثناء العملية، ابدأ العملية من جديد');
  }
}

function getOptionalActorId(event: IpcMainInvokeEvent): number | null {
  try {
    return requireAuthenticatedUser(event).id;
  } catch {
    return null;
  }
}

const BARCODE_ITEM_POSITIONS = [
  'top',
  'top-left',
  'top-right',
  'above_barcode',
  'below_barcode',
  'bottom',
  'bottom-left',
  'bottom-right',
  'hidden',
] as const;

const BARCODE_ITEM_ALIGNS = ['left', 'center', 'right'] as const;

const RECEIPT_PAPER_SIZES = ['80mm', '58mm', 'custom'] as const;

function requirePrintBoolean(value: unknown, label: string) {
  const result = optionalBooleanValue(value, label);

  if (result === undefined) {
    throw new Error(`${label} مطلوبة`);
  }

  return result;
}

function requirePrintNumber(
  value: unknown,
  label: string,
  options?: {
    min?: number;
    max?: number;
    integer?: boolean;
  },
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} غير صحيح`);
  }

  if (options?.integer && !Number.isInteger(value)) {
    throw new Error(`${label} غير صحيح`);
  }

  if (options?.min !== undefined && value < options.min) {
    throw new Error(`${label} أقل من الحد المسموح`);
  }

  if (options?.max !== undefined && value > options.max) {
    throw new Error(`${label} أكبر من الحد المسموح`);
  }

  return value;
}

function normalizeBarcodePrintSettings(input: unknown) {
  const payload = requireObjectInput(input, 'إعدادات طباعة الباركود');

  return {
    barcode_label_width_mm: requirePrintNumber(
      payload.barcode_label_width_mm,
      'عرض ملصق الباركود',
      {
        min: Number.EPSILON,
      },
    ),

    barcode_label_height_mm: requirePrintNumber(
      payload.barcode_label_height_mm,
      'ارتفاع ملصق الباركود',
      {
        min: Number.EPSILON,
      },
    ),

    barcode_copies: requirePrintNumber(
      payload.barcode_copies,
      'عدد نسخ الباركود',
      {
        min: 1,
        integer: true,
      },
    ),

    barcode_auto_print_after_save: requirePrintBoolean(
      payload.barcode_auto_print_after_save,
      'الطباعة التلقائية للباركود',
    ),

    barcode_content_offset_x_mm: requirePrintNumber(
      payload.barcode_content_offset_x_mm,
      'إزاحة الباركود الأفقية',
    ),

    barcode_content_offset_y_mm: requirePrintNumber(
      payload.barcode_content_offset_y_mm,
      'إزاحة الباركود الرأسية',
    ),

    barcode_name_font_size: requirePrintNumber(
      payload.barcode_name_font_size,
      'حجم خط اسم المنتج',
      {
        min: Number.EPSILON,
      },
    ),

    barcode_name_position: requireEnumValue(
      payload.barcode_name_position,
      BARCODE_ITEM_POSITIONS,
      'مكان اسم المنتج',
    ),

    barcode_name_align: requireEnumValue(
      payload.barcode_name_align,
      BARCODE_ITEM_ALIGNS,
      'محاذاة اسم المنتج',
    ),

    barcode_price_font_size: requirePrintNumber(
      payload.barcode_price_font_size,
      'حجم خط السعر',
      {
        min: Number.EPSILON,
      },
    ),

    barcode_price_position: requireEnumValue(
      payload.barcode_price_position,
      BARCODE_ITEM_POSITIONS,
      'مكان السعر',
    ),

    barcode_price_align: requireEnumValue(
      payload.barcode_price_align,
      BARCODE_ITEM_ALIGNS,
      'محاذاة السعر',
    ),

    barcode_size_font_size: requirePrintNumber(
      payload.barcode_size_font_size,
      'حجم خط المقاس',
      {
        min: Number.EPSILON,
      },
    ),

    barcode_size_position: requireEnumValue(
      payload.barcode_size_position,
      BARCODE_ITEM_POSITIONS,
      'مكان المقاس',
    ),

    barcode_size_align: requireEnumValue(
      payload.barcode_size_align,
      BARCODE_ITEM_ALIGNS,
      'محاذاة المقاس',
    ),

    barcode_color_font_size: requirePrintNumber(
      payload.barcode_color_font_size,
      'حجم خط اللون',
      {
        min: Number.EPSILON,
      },
    ),

    barcode_color_position: requireEnumValue(
      payload.barcode_color_position,
      BARCODE_ITEM_POSITIONS,
      'مكان اللون',
    ),

    barcode_color_align: requireEnumValue(
      payload.barcode_color_align,
      BARCODE_ITEM_ALIGNS,
      'محاذاة اللون',
    ),

    barcode_value_font_size: requirePrintNumber(
      payload.barcode_value_font_size,
      'حجم خط قيمة الباركود',
      {
        min: Number.EPSILON,
      },
    ),

    barcode_value_position: requireEnumValue(
      payload.barcode_value_position,
      BARCODE_ITEM_POSITIONS,
      'مكان قيمة الباركود',
    ),

    barcode_value_align: requireEnumValue(
      payload.barcode_value_align,
      BARCODE_ITEM_ALIGNS,
      'محاذاة قيمة الباركود',
    ),

    barcode_svg_height: requirePrintNumber(
      payload.barcode_svg_height,
      'ارتفاع صورة الباركود',
      {
        min: Number.EPSILON,
      },
    ),
  };
}

function normalizeReceiptPrintSettings(input: unknown) {
  const payload = requireObjectInput(input, 'إعدادات طباعة الفاتورة');

  return {
    receipt_silent_print: requirePrintBoolean(
      payload.receipt_silent_print,
      'الطباعة الصامتة',
    ),

    receipt_paper_size: requireEnumValue(
      payload.receipt_paper_size,
      RECEIPT_PAPER_SIZES,
      'مقاس ورق الفاتورة',
    ),

    receipt_width_px: requirePrintNumber(
      payload.receipt_width_px,
      'عرض الفاتورة',
      {
        min: 150,
        max: 320,
      },
    ),

    receipt_padding_top_px: requirePrintNumber(
      payload.receipt_padding_top_px,
      'الهامش العلوي',
      {
        min: 0,
        max: 60,
      },
    ),

    receipt_padding_right_px: requirePrintNumber(
      payload.receipt_padding_right_px,
      'الهامش الأيمن',
      {
        min: 0,
        max: 60,
      },
    ),

    receipt_padding_bottom_px: requirePrintNumber(
      payload.receipt_padding_bottom_px,
      'الهامش السفلي',
      {
        min: 0,
        max: 60,
      },
    ),

    receipt_padding_left_px: requirePrintNumber(
      payload.receipt_padding_left_px,
      'الهامش الأيسر',
      {
        min: 0,
        max: 60,
      },
    ),

    receipt_font_size_px: requirePrintNumber(
      payload.receipt_font_size_px,
      'حجم خط الفاتورة',
      {
        min: 9,
        max: 16,
      },
    ),
  };
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-barcode-print', (event) => {
    requireAuthenticatedAdmin(event);

    return getBarcodePrintSettings();
  });

  ipcMain.handle('settings:save-barcode-print', (event, input: unknown) => {
    const actorId = requireAuthenticatedAdmin(event);

    const settings = normalizeBarcodePrintSettings(input);

    const result = saveBarcodePrintSettings(settings);

    logAction({
      actor_id: actorId,
      action: 'barcode_print_settings_saved',
      entity: 'settings',
      entity_id: null,
      details: {
        description: 'تم تحديث إعدادات طباعة الباركود',
      },
    });

    return result;
  });

  ipcMain.handle('settings:get-receipt-print', (event) => {
    /*
     * الكاشير يحتاج إعدادات مقاس وطباعة الإيصال.
     */
    requireAuthenticatedUser(event);

    return getReceiptPrintSettings();
  });

  ipcMain.handle('settings:save-receipt-print', (event, input: unknown) => {
    const actorId = requireAuthenticatedAdmin(event);

    const settings = normalizeReceiptPrintSettings(input);

    const result = saveReceiptPrintSettings(settings);

    logAction({
      actor_id: actorId,
      action: 'receipt_print_settings_saved',
      entity: 'settings',
      entity_id: null,
      details: {
        description: 'تم تحديث إعدادات طباعة الفاتورة',
      },
    });

    return result;
  });

  ipcMain.handle('settings:get-loyalty', (event) => {
    /*
     * شاشة البيع تحتاج قواعد النقاط.
     */
    requireAuthenticatedUser(event);

    return getLoyaltySettings();
  });

  ipcMain.handle('settings:save-loyalty', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);

    const payload = requireObjectInput(input, 'إعدادات نقاط الولاء');

    const loyaltyEnabled = optionalBooleanValue(
      payload.loyalty_enabled,
      'حالة تفعيل نقاط الولاء',
    );

    if (loyaltyEnabled === undefined) {
      throw new Error('حالة تفعيل نقاط الولاء مطلوبة');
    }

    const settings = {
      loyalty_enabled: loyaltyEnabled,

      loyalty_earn_amount: requirePositiveMoney(
        payload.loyalty_earn_amount,
        'قيمة كسب النقاط',
      ),

      loyalty_earn_points: requirePositiveInteger(
        payload.loyalty_earn_points,
        'عدد النقاط المكتسبة',
      ),

      loyalty_point_value: requirePositiveMoney(
        payload.loyalty_point_value,
        'قيمة النقطة',
      ),

      loyalty_min_redeem_points: requirePositiveInteger(
        payload.loyalty_min_redeem_points,
        'الحد الأدنى لاستخدام النقاط',
      ),
    };

    return runCriticalActionWithAudit(
      () => saveLoyaltySettings(settings),

      () => ({
        actor_id: actorId,

        action: 'loyalty_settings_saved',

        entity: 'settings',

        entity_id: null,

        details: {
          description: 'تم تحديث إعدادات نقاط الولاء',
        },
      }),
    );
  });

  ipcMain.handle(
    'settings:backup-database',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);
        const parentWindow = BrowserWindow.fromWebContents(event.sender);

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
        };

        const result = parentWindow
          ? await dialog.showSaveDialog(parentWindow, options)
          : await dialog.showSaveDialog(options);

        if (result.canceled || !result.filePath) {
          return {
            success: false,
            canceled: true,
            message: 'تم إلغاء حفظ النسخة الاحتياطية',
          };
        }

        recheckAdmin(event, actorId);

        const validation = await createVerifiedDatabaseBackup(result.filePath);

        logAction({
          actor_id: actorId,
          action: 'database_backup_created',
          entity: 'settings',
          entity_id: null,
          details: {
            path: result.filePath,

            size: validation.size,

            integrity: 'ok',
          },
        });

        return {
          success: true,
          path: result.filePath,
          validation,
          message: 'تم حفظ النسخة الاحتياطية بنجاح',
        };
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle(
    'settings:restore-database',
    async (
      event,
      _input?: {
        actor_id?: number;
      },
    ) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);

        const actorSnapshot = getDb()
          .prepare(
            `
            SELECT
              name,
              username

            FROM users

            WHERE id = ?

            LIMIT 1
            `,
          )
          .get(actorId) as
          | {
              name: string;
              username: string;
            }
          | undefined;

        const parentWindow = BrowserWindow.fromWebContents(event.sender);

        const options: OpenDialogOptions = {
          title: 'اختيار نسخة احتياطية للاسترجاع',

          properties: ['openFile'],

          filters: [
            {
              name: 'SQLite Database / Backup',

              extensions: ['db', 'bak'],
            },

            {
              name: 'All Files',

              extensions: ['*'],
            },
          ],
        };

        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths[0]) {
          return {
            success: false,
            canceled: true,

            message: 'تم إلغاء استرجاع النسخة الاحتياطية',
          };
        }

        const selectedFile = result.filePaths[0];

        /*
         * Validation قبل حتى
         * إظهار Confirm النهائي.
         */
        const validation = validateErpDatabaseFile(selectedFile);

        recheckAdmin(event, actorId);

        const confirmOptions = {
          type: 'warning' as const,

          buttons: ['إلغاء', 'استرجاع النسخة'],

          defaultId: 0,
          cancelId: 0,

          title: 'تأكيد استرجاع قاعدة البيانات',

          message: 'هل أنت متأكد من استرجاع هذه النسخة؟',

          detail: `سيتم استبدال بيانات البرنامج الحالية بالكامل.\n\nحجم النسخة: ${(validation.size / 1024 / 1024).toFixed(2)} MB\n\nسيتم إنشاء نسخة أمان تلقائية من البيانات الحالية قبل الاسترجاع، وسيتم الرجوع إليها تلقائيًا إذا فشل الاسترجاع.`,
        };

        const confirmation = parentWindow
          ? await dialog.showMessageBox(parentWindow, confirmOptions)
          : await dialog.showMessageBox(confirmOptions);

        if (confirmation.response !== 1) {
          return {
            success: false,
            canceled: true,

            message: 'تم إلغاء استرجاع النسخة الاحتياطية',
          };
        }

        recheckAdmin(event, actorId);

        const restored = await restoreVerifiedDatabase(selectedFile);

        /*
         * القاعدة نفسها اتغيرت.
         * لا نستخدم actor_id القديم
         * داخل القاعدة المسترجعة.
         */
        logAction({
          actor_id: null,

          action: 'database_restored',

          entity: 'settings',

          entity_id: null,

          details: {
            restored_from: selectedFile,

            safety_backup: restored.safetyBackupPath,

            previous_actor_id: actorId,

            previous_actor_name: actorSnapshot?.name || null,

            previous_actor_username: actorSnapshot?.username || null,

            source_size: validation.size,

            integrity: 'ok',
          },
        });

        /*
         * User table قد تكون تغيرت.
         * Session القديمة غير صالحة.
         */
        clearAuthSession(event);

        return {
          success: true,

          path: selectedFile,

          safetyBackupPath: restored.safetyBackupPath ?? undefined,

          requires_relogin: true,

          validation,

          message: 'تم استرجاع النسخة الاحتياطية والتحقق من سلامتها بنجاح',
        };
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle(
    'settings:reset-database',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);
        const actorSnapshot = getDb()
          .prepare(
            `
            SELECT
              name,
              username

            FROM users

            WHERE id = ?

            LIMIT 1
            `,
          )
          .get(actorId) as
          | {
              name: string;
              username: string;
            }
          | undefined;
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
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
            });

        if (saveResult.canceled || !saveResult.filePath) {
          return {
            success: false,
            canceled: true,
            message: 'تم إلغاء التصفير لأنك لم تختر مكان حفظ نسخة الأمان',
          };
        }

        recheckAdmin(event, actorId);

        const safetyBackupPath = saveResult.filePath;
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
            });

        if (confirmResult.response !== 1) {
          return {
            success: false,
            canceled: true,
            message: 'تم إلغاء تصفير البرنامج',
          };
        }

        recheckAdmin(event, actorId);

        const safetyValidation =
          await createVerifiedDatabaseBackup(safetyBackupPath);

        recheckAdmin(event, actorId);

        resetDatabaseData();

        logAction({
          /*
           * الحساب القديم تم مسحه
           * أثناء Factory Reset،
           * لذلك الـFK لازم يكون NULL.
           */
          actor_id: null,

          action: 'database_reset',

          entity: 'settings',

          entity_id: null,

          details: {
            safety_backup: safetyBackupPath,

            previous_actor_id: actorId,

            previous_actor_name: actorSnapshot?.name || null,
            safety_backup_size: safetyValidation.size,

            safety_backup_integrity: 'ok',

            previous_actor_username: actorSnapshot?.username || null,
          },
        });

        clearAuthSession(event);

        return {
          success: true,
          requires_setup: true,
          safetyBackupPath,
          message: 'تم تصفير البرنامج بنجاح',
        };
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle('settings:get-auto-backup-info', (event) => {
    requireAuthenticatedAdmin(event);
    return getAutoBackupInfo();
  });

  ipcMain.handle(
    'settings:choose-auto-backup-dir',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);

        const parentWindow = BrowserWindow.fromWebContents(event.sender);

        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, {
              title: 'اختيار مكان النسخ التلقائي',
              properties: ['openDirectory', 'createDirectory'],
            })
          : await dialog.showOpenDialog({
              title: 'اختيار مكان النسخ التلقائي',
              properties: ['openDirectory', 'createDirectory'],
            });

        if (result.canceled || !result.filePaths[0]) {
          return {
            success: false,
            canceled: true,
          };
        }

        recheckAdmin(event, actorId);
        setAutoBackupDir(result.filePaths[0]);
        const backup = await createAutoBackup('manual');
        const info = backup.info || getAutoBackupInfo();

        logAction({
          actor_id: actorId,
          action: 'auto_backup_dir_changed',
          entity: 'settings',
          entity_id: null,
          details: {
            path: result.filePaths[0],
            backup,
          },
        });

        return {
          success: true,
          info,
          backup,
          message: 'تم اختيار مكان النسخ التلقائي بنجاح',
        };
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle(
    'settings:run-auto-backup-now',
    async (event, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);

        const result = await createAutoBackup('manual');

        logAction({
          actor_id: actorId,
          action: 'auto_backup_run_now',
          entity: 'settings',
          entity_id: null,
          details: result,
        });

        return result;
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle('settings:get-license-status', () => {
    return getAppLicenseStatus();
  });

  ipcMain.handle('settings:activate-app', (event, code: string) => {
    const result = activateApp(code);

    if (result?.success !== false) {
      logAction({
        actor_id: getOptionalActorId(event),
        action: 'app_activated',
        entity: 'settings',
        entity_id: null,
        details: {
          description: 'تم تفعيل البرنامج',
        },
      });
    }

    return result;
  });

  ipcMain.handle('settings:deactivate-app', (event) => {
    const actorId = requireAuthenticatedAdmin(event);

    const result = deactivateApp();

    if (result?.success !== false) {
      logAction({
        actor_id: actorId,
        action: 'app_deactivated',
        entity: 'settings',
        entity_id: null,
        details: {
          description: 'تم إلغاء تفعيل البرنامج',
        },
      });
    }

    return result;
  });

  ipcMain.handle(
    'settings:save-app-logo-url',
    (event, url: string, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);

        const saved = saveAppLogoUrl(url);

        if (String(url || '').startsWith('data:image')) {
          updateOpenWindowsIcon(url);
        }

        logAction({
          actor_id: actorId,
          action: 'app_logo_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            has_logo: Boolean(String(url || '').trim()),
          },
        });
        return saved;
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle('settings:choose-app-logo', async (event) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);
      const parentWindow = BrowserWindow.fromWebContents(event.sender);

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
          });

      if (result.canceled || !result.filePaths[0]) {
        return {
          success: false,
          canceled: true,
        };
      }

      const selectedPath = result.filePaths[0];
      const mimeType = getImageMimeType(selectedPath);
      const buffer = fs.readFileSync(selectedPath);

      const logoUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

      const saved = saveAppLogoUrl(logoUrl);
      updateOpenWindowsIcon(logoUrl);
      logAction({
        actor_id: actorId,
        action: 'app_logo_saved',
        entity: 'settings',
        entity_id: null,
        details: {
          file_name: path.basename(selectedPath),
          has_logo: true,
        },
      });

      return {
        success: true,
        logoUrl,
        status: saved.status,
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle(
    'settings:save-app-name',
    (event, name: string, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);

        const saved = saveAppName(name);

        BrowserWindow.getAllWindows().forEach((window) => {
          window.setTitle(saved.status.app_name || 'ERP Store');
        });
        logAction({
          actor_id: actorId,
          action: 'app_name_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            name: saved.status.app_name,
          },
        });
        return saved;
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle(
    'settings:save-store-contact-info',
    (event, phone: string, address: string, input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event);

        const saved = saveStoreContactInfo(phone, address);

        logAction({
          actor_id: actorId,
          action: 'store_contact_info_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            phone,
            address,
          },
        });

        return saved;
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle('settings:save-store-qr-settings', (event, input?: any) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);

      const payload = {
        store_qr_enabled: Boolean(input?.store_qr_enabled),

        store_qr_title: String(input?.store_qr_title || '').trim(),

        store_qr_primary_url: String(input?.store_qr_primary_url || '').trim(),
      };

      const saved = saveStoreQrSettings(payload);

      logAction({
        actor_id: actorId,
        action: 'store_qr_settings_saved',
        entity: 'settings',
        entity_id: null,
        details: payload,
      });

      return saved;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle(
    'settings:save-app-theme',
    (event, theme: 'dark' | 'light', input?: { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedUser(event).id;

        const saved = saveAppTheme(theme);

        logAction({
          actor_id: actorId,
          action: 'app_theme_saved',
          entity: 'settings',
          entity_id: null,
          details: {
            theme,
          },
        });

        return saved;
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
        };
      }
    },
  );
}
