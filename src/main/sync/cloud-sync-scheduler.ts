import {
  getCloudSyncSettings,
  testCloudSyncConnection,
  uploadPendingSyncOperations,
  downloadServerEventsFromCloud
} from '../database/repositories/sync.repo';

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runCloudSyncOnce(limit = 25) {
  if (running) {
    return {
      success: false,
      skipped: true,
      message: 'المزامنة تعمل بالفعل'
    };
  }

  running = true;

  try {
    const settings = getCloudSyncSettings();

    if (!settings.cloud_sync_enabled) {
      return {
        success: true,
        skipped: true,
        message: 'المزامنة الأونلاين غير مفعلة'
      };
    }

    if (!settings.cloud_server_url) {
      return {
        success: false,
        skipped: true,
        message: 'رابط السيرفر غير مسجل'
      };
    }

    const ping = await testCloudSyncConnection(settings);

    if (!ping.success) {
      return {
        success: false,
        skipped: true,
        message: ping.message || 'السيرفر غير متاح'
      };
    }

    const uploadResult = await uploadPendingSyncOperations(limit);
    const downloadResult = await downloadServerEventsFromCloud(200);

    return {
      success: Boolean(uploadResult.success && downloadResult.success),
      upload: uploadResult,
      download: downloadResult,
      message: `رفع: ${uploadResult.uploaded || 0} / سحب: ${downloadResult.received || 0}`
    };
  } finally {
    running = false;
  }
}

export function startCloudSyncScheduler() {
  if (timer) {
    return;
  }

  setTimeout(() => {
    void runCloudSyncOnce(25);
  }, 5000);

  timer = setInterval(() => {
    void runCloudSyncOnce(25);
  }, 30 * 1000);
}

export function stopCloudSyncScheduler() {
  if (!timer) {
    return;
  }

  clearInterval(timer);
  timer = null;
}