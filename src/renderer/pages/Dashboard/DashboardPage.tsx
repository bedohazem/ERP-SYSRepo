export default function DashboardPage() {
  const stats = [
    { title: 'إجمالي المبيعات اليوم', value: '12,450 ج.م', note: '+18%', color: '#60a5fa' },
    { title: 'عدد الفواتير', value: '38', note: '+6', color: '#34d399' },
    { title: 'المنتجات منخفضة المخزون', value: '9', note: 'تنبيه', color: '#f59e0b' },
    { title: 'الأرباح التقديرية', value: '4,230 ج.م', note: '+11%', color: '#a78bfa' }
  ];

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '18px'
        }}
      >
        {stats.map((item) => (
          <div
            key={item.title}
            className="glass-card"
            style={{
              borderRadius: '22px',
              padding: '18px'
            }}
          >
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '12px' }}>
              {item.title}
            </div>

            <div style={{ fontSize: '28px', fontWeight: 800, marginBottom: '10px' }}>
              {item.value}
            </div>

            <div
              style={{
                color: item.color,
                fontWeight: 700,
                fontSize: '14px'
              }}
            >
              {item.note}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: '18px'
        }}
      >
        <div
          className="glass-card"
          style={{
            borderRadius: '24px',
            padding: '22px',
            minHeight: '320px'
          }}
        >
          <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
            نظرة عامة
          </div>
          <div style={{ color: '#94a3b8', marginBottom: '20px' }}>
            دي بداية لوحة التحكم. بعد كده هنربطها بالداتابيز والتقارير الحقيقية.
          </div>

          <div
            style={{
              height: '220px',
              borderRadius: '20px',
              border: '1px dashed rgba(255,255,255,0.14)',
              background:
                'linear-gradient(180deg, rgba(37,99,235,0.08), rgba(139,92,246,0.06))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#cbd5e1',
              fontSize: '18px'
            }}
          >
            مكان الرسم البياني هنا لاحقًا
          </div>
        </div>

        <div
          className="glass-card"
          style={{
            borderRadius: '24px',
            padding: '22px',
            minHeight: '320px'
          }}
        >
          <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
            آخر الأنشطة
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {[
              'تم إنشاء أول مشروع بنجاح',
              'تم تفعيل واجهة عربية RTL',
              'الخطوة التالية: Login + Routing',
              'بعدها: Products + Sales'
            ].map((item, idx) => (
              <div
                key={idx}
                className="soft-card"
                style={{
                  borderRadius: '16px',
                  padding: '14px 16px'
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}