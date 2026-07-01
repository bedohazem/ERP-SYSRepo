import { useEffect, useMemo, useState } from 'react';

type TabKey = 'all' | 'pending' | 'failed' | 'synced' | 'conflicts' | 'inbox';

export default function SyncPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [operations, setOperations] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [cloudSettings, setCloudSettings] = useState({
    cloud_server_url: '',
    cloud_api_key: '',
    cloud_branch_id: '',
    cloud_sync_enabled: false
  });

  const [connectionResult, setConnectionResult] = useState<any>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);

  const [downloadedEvents, setDownloadedEvents] = useState<any[]>([]);
  const [downloadResult, setDownloadResult] = useState<any>(null);

  const [applyResult, setApplyResult] = useState<any>(null);

  const operationStatus = useMemo(() => {
    if (activeTab === 'pending') return 'pending';
    if (activeTab === 'failed') return 'failed';
    if (activeTab === 'synced') return 'synced';
    return 'all';
  }, [activeTab]);

  async function loadData() {
    setLoading(true);

    try {
      const syncStatus = await window.api.getSyncStatus();
      setStatus(syncStatus);

      const cloud = await window.api.getCloudSyncSettings();
      if (cloud?.settings) {
        setCloudSettings(cloud.settings);
      }

      if (activeTab === 'conflicts') {
        const result = await window.api.listSyncConflicts({
          status: 'all',
          limit: 200
        });

        setConflicts(result.conflicts || []);
      } else if (activeTab === 'inbox') {
        const result = await window.api.listDownloadedServerEvents({
          status: 'all',
          limit: 200
        });

        setDownloadedEvents(result.events || []);
      } else {
        const result = await window.api.listSyncOperations({
          status: operationStatus,
          limit: 200
        });

        setOperations(result.operations || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [activeTab, operationStatus]);

  async function retryFailed() {
    await window.api.retryFailedSyncOperations();
    await loadData();
  }

  async function resolveConflict(conflictId: string, nextStatus: 'resolved' | 'ignored') {
    await window.api.resolveSyncConflict({
      conflict_id: conflictId,
      status: nextStatus
    });

    await loadData();
  }

  async function saveCloudSettings() {
    const result = await window.api.saveCloudSyncSettings(cloudSettings);

    if (result?.success === false) {
      setConnectionResult({
        success: false,
        message: result.message || 'فشل حفظ الإعدادات'
      });
      return;
    }

    setConnectionResult({
      success: true,
      message: 'تم حفظ إعدادات السيرفر'
    });

    await loadData();
  }

  async function testConnection() {
    const result = await window.api.testCloudSyncConnection(cloudSettings);
    setConnectionResult(result);
  }

  async function uploadPendingNow() {
    setLoading(true);

    try {
      const result = await window.api.uploadPendingSyncOperations(20);
      setUploadResult(result);
      await loadData();
    } finally {
      setLoading(false);
    }
  }

  async function downloadEventsNow() {
    setLoading(true);

    try {
      const result = await window.api.downloadServerEvents(200);
      setDownloadResult(result);
      await loadData();
    } finally {
      setLoading(false);
    }
  }

  async function applyDownloadedNow() {
    setLoading(true);

    try {
      const result = await window.api.applyDownloadedServerEvents(50);
      setApplyResult(result);
      await loadData();
    } finally {
      setLoading(false);
    }
  }

  async function uploadOneOperation(operationId: string) {
    setLoading(true);

    try {
      const result = await window.api.uploadSyncOperation(operationId);
      setUploadResult(result);
      await loadData();
    } finally {
      setLoading(false);
    }
  }

  function formatPayload(payload: any) {
    if (!payload) return '';

    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return String(payload);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '12px'
        }}
      >
        <InfoCard title="حالة الاتصال" value={status?.online ? 'متصل' : 'أوفلاين'} />
        <InfoCard title="عمليات معلقة" value={status?.pending_count ?? 0} />
        <InfoCard title="عمليات فاشلة" value={status?.failed_count ?? 0} />
        <InfoCard title="تعارضات مفتوحة" value={status?.open_conflicts ?? 0} />
        <InfoCard title="آخر مزامنة" value={status?.last_sync_at || 'لم تتم بعد'} />
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px' }}>إعدادات السيرفر Online</h3>
            <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '13px' }}>
              دي أول خطوة للربط الأونلاين. لما نعمل السيرفر، الرابط هيبقى مثلًا:
              https://api.your-domain.com
            </p>
          </div>

          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ color: '#cbd5e1', fontWeight: 800 }}>رابط السيرفر</span>
            <input
              value={cloudSettings.cloud_server_url}
              onChange={(event) =>
                setCloudSettings((prev) => ({
                  ...prev,
                  cloud_server_url: event.target.value
                }))
              }
              placeholder="https://api.your-domain.com"
              style={inputStyle}
              dir="ltr"
            />
          </label>

          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ color: '#cbd5e1', fontWeight: 800 }}>API Key</span>
            <input
              value={cloudSettings.cloud_api_key}
              onChange={(event) =>
                setCloudSettings((prev) => ({
                  ...prev,
                  cloud_api_key: event.target.value
                }))
              }
              placeholder="اختياري الآن"
              style={inputStyle}
              dir="ltr"
            />
          </label>

          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ color: '#cbd5e1', fontWeight: 800 }}>كود الفرع</span>
            <input
              value={cloudSettings.cloud_branch_id}
              onChange={(event) =>
                setCloudSettings((prev) => ({
                  ...prev,
                  cloud_branch_id: event.target.value
                }))
              }
              placeholder="مثال: samnoud-main"
              style={inputStyle}
              dir="ltr"
            />
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#e5e7eb',
              fontWeight: 800
            }}
          >
            <input
              type="checkbox"
              checked={cloudSettings.cloud_sync_enabled}
              onChange={(event) =>
                setCloudSettings((prev) => ({
                  ...prev,
                  cloud_sync_enabled: event.target.checked
                }))
              }
            />
            تفعيل المزامنة الأونلاين
          </label>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void saveCloudSettings()} style={buttonStyle}>
              حفظ الإعدادات
            </button>

            <button type="button" onClick={() => void testConnection()} style={buttonStyle}>
              اختبار الاتصال
            </button>
          </div>

          {connectionResult && (
            <div
              style={{
                ...noteStyle,
                color: connectionResult.success ? '#86efac' : '#fca5a5',
                borderColor: connectionResult.success
                  ? 'rgba(34,197,94,0.35)'
                  : 'rgba(239,68,68,0.35)'
              }}
            >
              {connectionResult.message}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <TabButton active={activeTab === 'pending'} onClick={() => setActiveTab('pending')}>
            المعلقة
          </TabButton>
          <TabButton active={activeTab === 'failed'} onClick={() => setActiveTab('failed')}>
            الفاشلة
          </TabButton>
          <TabButton active={activeTab === 'synced'} onClick={() => setActiveTab('synced')}>
            المتزامنة
          </TabButton>
          <TabButton active={activeTab === 'all'} onClick={() => setActiveTab('all')}>
            الكل
          </TabButton>
          <TabButton active={activeTab === 'conflicts'} onClick={() => setActiveTab('conflicts')}>
            التعارضات
          </TabButton>
          <TabButton active={activeTab === 'inbox'} onClick={() => setActiveTab('inbox')}>
            وارد من السيرفر
          </TabButton>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={() => void loadData()} style={buttonStyle}>
            تحديث
          </button>

          <button type="button" onClick={() => void uploadPendingNow()} style={buttonStyle}>
            مزامنة الآن
          </button>

          <button type="button" onClick={() => void downloadEventsNow()} style={buttonStyle}>
            سحب من السيرفر
          </button>

          <button type="button" onClick={() => void applyDownloadedNow()} style={buttonStyle}>
            تطبيق الوارد
          </button>

          <button type="button" onClick={() => void retryFailed()} style={dangerButtonStyle}>
            إعادة محاولة الفاشل
          </button>
        </div>
      </div>

      {uploadResult && (
        <div
          style={{
            ...noteStyle,
            color: uploadResult.success ? '#86efac' : '#fca5a5',
            borderColor: uploadResult.success
              ? 'rgba(34,197,94,0.35)'
              : 'rgba(239,68,68,0.35)'
          }}
        >
          {uploadResult.total != null
            ? `تم رفع ${uploadResult.uploaded} من ${uploadResult.total} - فشل ${uploadResult.failed}`
            : uploadResult.message || 'تم تنفيذ العملية'}
        </div>
      )}

      {downloadResult && (
        <div
          style={{
            ...noteStyle,
            color: downloadResult.success ? '#86efac' : '#fca5a5',
            borderColor: downloadResult.success
              ? 'rgba(34,197,94,0.35)'
              : 'rgba(239,68,68,0.35)'
          }}
        >
          {downloadResult.message || `تم سحب ${downloadResult.received || 0} عملية من السيرفر`}
        </div>
      )}

      {applyResult && (
        <div
          style={{
            ...noteStyle,
            color: applyResult.success ? '#86efac' : '#fca5a5',
            borderColor: applyResult.success
              ? 'rgba(34,197,94,0.35)'
              : 'rgba(239,68,68,0.35)'
          }}
        >
          {applyResult.message || `تم تطبيق ${applyResult.applied || 0} من ${applyResult.total || 0}`}
        </div>
      )}

      {loading && <div style={noteStyle}>جاري التحميل...</div>}

      {!loading && activeTab !== 'conflicts' && (
        <div style={{ display: 'grid', gap: '10px' }}>
          {operations.length === 0 ? (
            <div style={noteStyle}>لا توجد عمليات في هذا القسم</div>
          ) : (
            operations.map((operation) => (
              <OperationCard
                key={operation.id}
                operation={operation}
                payload={formatPayload(operation.payload)}
                onUpload={() => void uploadOneOperation(operation.id)}
              />
            ))
          )}
        </div>
      )}

      {!loading && activeTab === 'conflicts' && (
        <div style={{ display: 'grid', gap: '10px' }}>
          {conflicts.length === 0 ? (
            <div style={noteStyle}>لا توجد تعارضات</div>
          ) : (
            conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                payload={formatPayload(conflict.payload)}
                onResolve={() => void resolveConflict(conflict.id, 'resolved')}
                onIgnore={() => void resolveConflict(conflict.id, 'ignored')}
              />
            ))
          )}
        </div>
      )}

      {!loading && activeTab === 'inbox' && (
        <div style={{ display: 'grid', gap: '10px' }}>
          {downloadedEvents.length === 0 ? (
            <div style={noteStyle}>لا توجد عمليات واردة من السيرفر</div>
          ) : (
            downloadedEvents.map((event) => (
              <OperationCard
                key={event.version}
                operation={{
                  id: event.operation_id,
                  type: event.type,
                  entity: event.entity,
                  entity_id: event.entity_id,
                  status: event.status,
                  attempts: 0,
                  error: event.error,
                  created_at: event.received_at
                }}
                payload={formatPayload(event.payload)}
                onUpload={() => {}}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function InfoCard({ title, value }: { title: string; value: any }) {
  return (
    <div style={cardStyle}>
      <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '18px', fontWeight: 900, wordBreak: 'break-word' }}>{String(value)}</div>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: any;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...buttonStyle,
        background: active ? '#2563eb' : 'rgba(15,23,42,0.75)',
        borderColor: active ? '#60a5fa' : 'rgba(255,255,255,0.12)'
      }}
    >
      {children}
    </button>
  );
}

function OperationCard({
  operation,
  payload,
  onUpload
}: {
  operation: any;
  payload: string;
  onUpload?: () => void;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <strong>{operation.type}</strong>
        <span style={pillStyle(operation.status)}>{operation.status}</span>
      </div>

      <div style={metaStyle}>
        Entity: {operation.entity || '-'} #{operation.entity_id || '-'} — Attempts: {operation.attempts || 0}
      </div>

      <div style={metaStyle}>Created: {operation.created_at}</div>

      {operation.status !== 'synced' && onUpload && (
        <button
          type="button"
          onClick={onUpload}
          style={{ ...buttonStyle, marginTop: '10px' }}
        >
          رفع هذه العملية
        </button>
      )}

      {operation.error && (
        <div style={{ ...noteStyle, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)' }}>
          {operation.error}
        </div>
      )}

      <details style={{ marginTop: '10px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Payload</summary>
        <pre style={preStyle}>{payload}</pre>
      </details>
    </div>
  );
}

function ConflictCard({
  conflict,
  payload,
  onResolve,
  onIgnore
}: {
  conflict: any;
  payload: string;
  onResolve: () => void;
  onIgnore: () => void;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <strong>{conflict.type}</strong>
        <span style={pillStyle(conflict.status)}>{conflict.status}</span>
      </div>

      <div style={{ marginTop: '8px', color: '#fca5a5', fontWeight: 800 }}>
        {conflict.message}
      </div>

      <div style={metaStyle}>Created: {conflict.created_at}</div>

      {conflict.status === 'open' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
          <button type="button" onClick={onResolve} style={buttonStyle}>
            تم الحل
          </button>
          <button type="button" onClick={onIgnore} style={dangerButtonStyle}>
            تجاهل
          </button>
        </div>
      )}

      <details style={{ marginTop: '10px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Payload</summary>
        <pre style={preStyle}>{payload}</pre>
      </details>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(15,23,42,0.78)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '18px',
  padding: '14px',
  color: '#e5e7eb'
};

const buttonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(15,23,42,0.75)',
  color: '#fff',
  borderRadius: '12px',
  padding: '10px 14px',
  cursor: 'pointer',
  fontWeight: 800
};

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'rgba(239,68,68,0.16)',
  border: '1px solid rgba(239,68,68,0.35)',
  color: '#fecaca'
};

const noteStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(15,23,42,0.65)',
  color: '#cbd5e1',
  borderRadius: '14px',
  padding: '12px'
};

const metaStyle: React.CSSProperties = {
  marginTop: '8px',
  color: '#94a3b8',
  fontSize: '13px'
};

const preStyle: React.CSSProperties = {
  marginTop: '10px',
  padding: '12px',
  borderRadius: '12px',
  background: 'rgba(2,6,23,0.85)',
  overflowX: 'auto',
  color: '#dbeafe',
  fontSize: '12px',
  direction: 'ltr',
  textAlign: 'left'
};

function pillStyle(status: string): React.CSSProperties {
  const color =
    status === 'pending'
      ? '#facc15'
      : status === 'synced'
        ? '#22c55e'
        : status === 'failed'
          ? '#ef4444'
          : status === 'open'
            ? '#f97316'
            : '#94a3b8';

  return {
    color,
    border: `1px solid ${color}`,
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 900
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(2,6,23,0.72)',
  color: '#fff',
  borderRadius: '12px',
  padding: '11px 12px',
  outline: 'none',
  boxSizing: 'border-box'
};