import { EventEmitter } from 'node:events'

import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  createUser,
  findUserByUsername,
} from '../../src/main/database/repositories/user.repo'

import {
  createCategory,
  toggleCategoryActive,
} from '../../src/main/database/repositories/product.repo'

import { startAuthSession } from '../../src/main/auth-session'

import { registerProductsIpc } from '../../src/main/ipc/products.ipc'

import { registerPromotionsIpc } from '../../src/main/ipc/promotions.ipc'

import { registerSettingsIpc } from '../../src/main/ipc/settings.ipc'

import { registerCashDrawerIpc } from '../../src/main/ipc/cash-drawer.ipc'

import { registerPrintIpc } from '../../src/main/ipc/print.ipc'

type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => any

const handlers = new Map<string, Handler>()

function makeClient() {
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => false,
  })

  const event = {
    sender,
    senderFrame: sender.mainFrame,
  } as unknown as IpcMainInvokeEvent

  return {
    sender,
    event,
  }
}

async function invoke(
  event: IpcMainInvokeEvent,
  channel: string,
  ...args: any[]
) {
  const handler = handlers.get(channel)

  if (!handler) {
    throw new Error(`Missing handler: ${channel}`)
  }

  return handler(event, ...args)
}

describe('IPC security hardening', () => {
  beforeAll(() => {
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    registerProductsIpc()
    registerPromotionsIpc()
    registerSettingsIpc()
    registerCashDrawerIpc()
    registerPrintIpc()
  })

  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  afterAll(() => {
    vi.mocked(ipcMain.handle).mockReset()

    closeDb()
  })

  it('requires login for operational reads and receipt printing', async () => {
    const { event } = makeClient()

    await expect(invoke(event, 'products:get-categories', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'promotions:get-active')).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'settings:get-receipt-print')).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'settings:get-loyalty')).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'cash-drawer:get-settings')).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(
      invoke(event, 'print:silent-html', {
        html: '',
      }),
    ).rejects.toThrow('سجل الدخول أولًا')

    await expect(
      invoke(event, 'print:dialog-html', {
        html: '',
      }),
    ).rejects.toThrow('سجل الدخول أولًا')
  })

  it('allows cashier operational reads but hides admin configuration', async () => {
    const hiddenCategory = createCategory({
      name: 'Security Hidden Category',

      description: 'Security test',
    })

    toggleCategoryActive(hiddenCategory.id, 0)

    const cashier = createUser(
      'Security Cashier',
      'security_cashier',
      '5678',
      'cashier',
    )

    const client = makeClient()

    startAuthSession(client.event, cashier.id)

    /*
     * حتى لو الكاشير طلب
     * includeInactive=true
     * لازم الـIPC يتجاهله.
     */
    const categories = await invoke(client.event, 'products:get-categories', {
      includeInactive: true,
    })

    expect(
      categories.some(
        (category: any) => Number(category.id) === Number(hiddenCategory.id),
      ),
    ).toBe(false)

    /*
     * عمليات إدارة المنتجات
     * Admin only.
     */
    await expect(
      invoke(client.event, 'products:list-page', {}),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    await expect(invoke(client.event, 'products:list', {})).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    await expect(
      invoke(client.event, 'products:get-variants', {
        productId: 1,
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    /*
     * الكاشير يعرف العرض النشط
     * لأنه مطلوب في البيع.
     */
    const activePromotion = await invoke(client.event, 'promotions:get-active')

    expect(
      activePromotion === null || typeof activePromotion === 'object',
    ).toBe(true)

    await expect(invoke(client.event, 'promotions:list')).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    await expect(invoke(client.event, 'promotions:get', 1)).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    /*
     * إعدادات تشغيل البيع
     * متاحة للكاشير.
     */
    const receiptSettings = await invoke(
      client.event,
      'settings:get-receipt-print',
    )

    expect(typeof receiptSettings.receipt_silent_print).toBe('boolean')

    const loyaltySettings = await invoke(client.event, 'settings:get-loyalty')

    expect(typeof loyaltySettings.loyalty_enabled).toBe('boolean')

    /*
     * Barcode configuration
     * إعداد إداري.
     */
    await expect(
      invoke(client.event, 'settings:get-barcode-print'),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    /*
     * إلغاء تفعيل البرنامج
     * Admin only.
     */
    await expect(
      invoke(client.event, 'settings:deactivate-app'),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    /*
     * شاشة البيع تحتاج فقط
     * auto-open ولا تحتاج
     * اسم الطابعة.
     */
    const drawerSettings = await invoke(
      client.event,
      'cash-drawer:get-settings',
    )

    expect(drawerSettings.printer_name).toBe('')

    expect(typeof drawerSettings.auto_open_cash_sale).toBe('boolean')

    await expect(
      invoke(client.event, 'cash-drawer:list-printers'),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    /*
     * الكاشير مسموح له بطباعة
     * إيصال، ونستخدم HTML فارغ
     * حتى لا نفتح Printer حقيقي.
     */
    await expect(
      invoke(client.event, 'print:silent-html', {
        html: '',
      }),
    ).rejects.toThrow('لا يوجد محتوى للطباعة')

    const dialogResult = await invoke(client.event, 'print:dialog-html', {
      html: '',
    })

    expect(dialogResult.ok).toBe(false)

    expect(dialogResult.message).toContain('لا يوجد محتوى للطباعة')

    /*
     * PDF export حاليًا خاص
     * بالـAdmin domains.
     */
    await expect(
      invoke(client.event, 'print:save-pdf', {
        html: '<html></html>',
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')
  })

  it('keeps full administration reads available to admins', async () => {
    const hiddenCategory = createCategory({
      name: 'Admin Hidden Category',

      description: 'Security test',
    })

    toggleCategoryActive(hiddenCategory.id, 0)

    const admin = findUserByUsername('admin')!

    const client = makeClient()

    startAuthSession(client.event, admin.id)

    const categories = await invoke(client.event, 'products:get-categories', {
      includeInactive: true,
    })

    expect(
      categories.some(
        (category: any) => Number(category.id) === Number(hiddenCategory.id),
      ),
    ).toBe(true)

    const products = await invoke(client.event, 'products:list-page', {})

    expect(Array.isArray(products.rows)).toBe(true)

    const promotions = await invoke(client.event, 'promotions:list')

    expect(Array.isArray(promotions)).toBe(true)

    const barcodeSettings = await invoke(
      client.event,
      'settings:get-barcode-print',
    )

    expect(barcodeSettings).toBeTruthy()

    const drawerSettings = await invoke(
      client.event,
      'cash-drawer:get-settings',
    )

    expect('printer_name' in drawerSettings).toBe(true)

    /*
     * Electron mock يرجع null
     * كنافذة؛ المهم أن الـAdmin
     * عدى الصلاحية.
     */
    const printers = await invoke(client.event, 'cash-drawer:list-printers')

    expect(Array.isArray(printers)).toBe(true)
  })
})
