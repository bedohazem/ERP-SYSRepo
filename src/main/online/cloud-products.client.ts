import { getCloudSyncSettings } from '../database/repositories/sync.repo';
import {
  getCachedOnlineVariantByBarcode,
  saveOnlineVariantCache,
  saveOnlineVariantsCache,
  searchCachedOnlineSaleVariants
} from './online-product-cache.repo';

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

function mapCloudVariant(row: any) {
  return {
    variant_id: row.id,
    product_id: row.product_id,
    product_name: row.product_name || row.name || '',
    category_id: null,
    category_name: row.category_name || null,
    barcode: row.barcode || '',
    size: row.size || '',
    color: row.color || '',
    sell_price: toNumber(row.sale_price),
    buy_price: toNumber(row.buy_price),
    stock: toNumber(row.stock_quantity),
    min_stock: toNumber(row.min_stock),
    is_active: row.is_active ? 1 : 0,
    online: true
  };
}

export async function getOnlineVariantByBarcode(barcode: string) {
  const settings = getCloudSyncSettings();

  if (!settings.cloud_sync_enabled) {
    return {
      success: false,
      skipped: true,
      can_fallback: true,
      message: 'Online disabled'
    };
  }

  const serverUrl = normalizeServerUrl(settings.cloud_server_url);

  if (!serverUrl) {
    return {
      success: false,
      skipped: true,
      can_fallback: true,
      message: 'Server URL empty'
    };
  }

  try {
    const url =
      `${serverUrl}/api/products/variants/by-barcode/${encodeURIComponent(barcode)}` +
      `?warehouse_id=main-warehouse`;

    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(settings.cloud_api_key)
    });

    let result: any = null;

    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (response.status === 404) {
      return {
        success: false,
        not_found: true,
        can_fallback: false,
        message: 'الصنف غير موجود على السيرفر'
      };
    }

    if (!response.ok || result?.success === false) {
      return {
        success: false,
        can_fallback: false,
        status: response.status,
        message: result?.message || `فشل قراءة الصنف من السيرفر - كود ${response.status}`
      };
    }

    const variant = mapCloudVariant(result.variant);

    saveOnlineVariantCache(variant);

    return {
      success: true,
      variant
    };
  } catch (error) {
    const cached = getCachedOnlineVariantByBarcode(barcode);

    if (cached) {
      return {
        success: true,
        cached: true,
        variant: cached,
        message: 'تم قراءة الصنف من الكاش المحلي'
      };
    }

    return {
      success: false,
      network_error: true,
      can_fallback: true,
      message: error instanceof Error ? error.message : 'تعذر الاتصال بالسيرفر'
    };
  }
}

export async function searchOnlineSaleVariants(input: any) {
  const settings = getCloudSyncSettings();

  if (!settings.cloud_sync_enabled) {
    return {
      success: false,
      skipped: true,
      can_fallback: true,
      variants: []
    };
  }

  const serverUrl = normalizeServerUrl(settings.cloud_server_url);

  if (!serverUrl) {
    return {
      success: false,
      skipped: true,
      can_fallback: true,
      variants: []
    };
  }

  const query =
    typeof input === 'string'
      ? input
      : String(input?.query || '');

  try {
    const url =
      `${serverUrl}/api/products?warehouse_id=main-warehouse&search=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(settings.cloud_api_key)
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
        can_fallback: false,
        variants: [],
        message: result?.message || `فشل البحث من السيرفر - كود ${response.status}`
      };
    }

    const variants = Array.isArray(result.products)
      ? result.products.flatMap((product: any) =>
          Array.isArray(product.variants)
            ? product.variants.map((variant: any) =>
                mapCloudVariant({
                  ...variant,
                  product_name: product.name,
                  category_name: product.category_name
                })
              )
            : []
        )
      : [];

    saveOnlineVariantsCache(variants);

    return {
      success: true,
      variants
    };
  } catch {
    const cachedVariants = searchCachedOnlineSaleVariants(input);

    if (cachedVariants.length > 0) {
      return {
        success: true,
        cached: true,
        variants: cachedVariants
      };
    }

    return {
      success: false,
      network_error: true,
      can_fallback: true,
      variants: []
    };
  }
}