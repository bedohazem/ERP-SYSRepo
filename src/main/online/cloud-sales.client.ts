import { randomUUID } from 'node:crypto';
import { getCloudSyncSettings } from '../database/repositories/sync.repo';

function normalizeServerUrl(url: string) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function getHeaders(apiKey: string) {
  const cleanKey = String(apiKey || '').trim();

  return {
    'Content-Type': 'application/json',
    ...(cleanKey ? { Authorization: `Bearer ${cleanKey}` } : {})
  };
}

function buildCloudSaleReceipt(sale: any) {
  return {
    sale: {
      id: sale.invoice_no || sale.id,
      invoice_no: sale.invoice_no,
      customer_name: sale.customer_name || null,
      customer_phone: sale.customer_phone || null,
      cashier_name: sale.cashier_name || null,
      sub_total: toNumber(sale.sub_total),
      discount_value: toNumber(sale.discount_value),
      grand_total: toNumber(sale.grand_total),
      paid: toNumber(sale.paid_amount),
      remaining_amount: toNumber(sale.remaining_amount),
      payment_status: sale.payment_status || 'paid',
      change_amount: 0,
      payment_method: sale.payment_method || 'cash',
      loyalty_points_earned: 0,
      loyalty_points_redeemed: 0,
      loyalty_discount_value: 0,
      created_at: sale.created_at
    },
    items: Array.isArray(sale.items)
      ? sale.items.map((item: any) => ({
          id: item.id,
          product_name: item.product_name,
          barcode: item.barcode,
          size: item.size,
          color: item.color,
          quantity: toNumber(item.quantity),
          unit_price: toNumber(item.unit_price),
          line_total: toNumber(item.line_total)
        }))
      : [],
    loyalty: []
  };
}

function buildOnlineSaleBody(input: any) {
  const settings = getCloudSyncSettings();

  return {
    branch_id: settings.cloud_branch_id || 'main',
    warehouse_id: 'main-warehouse',
    cash_register_id: 'main-cashier-1',
    cashier_id: null,
    customer_id: null,

    client_operation_id: `online_sale_${randomUUID()}`,

    discount_value: toNumber(input.discount_value),
    paid_amount: input.paid == null ? toNumber(input.grand_total) : toNumber(input.paid),
    payment_method: input.payment_method || 'cash',
    notes: input.notes ?? null,

    items: Array.isArray(input.items)
      ? input.items.map((item: any) => ({
          barcode: item.barcode || null,
          variant_id: item.barcode ? null : String(item.variant_id || ''),
          quantity: toNumber(item.quantity),
          unit_price: toNumber(item.unit_price)
        }))
      : []
  };
}

export async function createOnlineSale(input: any) {
  const settings = getCloudSyncSettings();

  if (!settings.cloud_sync_enabled) {
    return {
      success: false,
      skipped: true,
      can_fallback: true,
      message: 'Online mode disabled'
    };
  }

  const serverUrl = normalizeServerUrl(settings.cloud_server_url);

  if (!serverUrl) {
    return {
      success: false,
      skipped: true,
      can_fallback: true,
      message: 'Cloud server URL is empty'
    };
  }

  const body = buildOnlineSaleBody(input);

  try {
    const response = await fetch(`${serverUrl}/api/sales`, {
      method: 'POST',
      headers: getHeaders(settings.cloud_api_key),
      body: JSON.stringify(body)
    });

    let result: any = null;

    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok || result?.success === false) {
      return {
        success: false,
        attempted: true,
        can_fallback: false,
        status: response.status,
        code: result?.code,
        message: result?.message || `فشل البيع الأونلاين - كود ${response.status}`
      };
    }

    const sale = result.sale;

    return {
      success: true,
      online: true,
      saleId: sale.invoice_no || sale.id,
      invoice_no: sale.invoice_no,
      cloud_sale_id: sale.id,
      receipt: buildCloudSaleReceipt(sale),
      message: 'تم حفظ الفاتورة أونلاين'
    };
  } catch (error) {
    return {
      success: false,
      attempted: true,
      can_fallback: true,
      network_error: true,
      message: error instanceof Error ? error.message : 'تعذر الاتصال بالسيرفر'
    };
  }
}