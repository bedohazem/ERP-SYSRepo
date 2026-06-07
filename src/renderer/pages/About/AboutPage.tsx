export default function AboutPage() {
  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section
        style={{
          background: 'rgba(15,23,42,0.55)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '18px',
          padding: '22px'
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: '26px' }}>
          ERP Store
        </h2>

        <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.8 }}>
          نظام إدارة مبيعات ومخزون وفواتير ومشتريات وتقارير للمحلات.
        </p>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px'
        }}
      >
        <InfoCard title="الإصدار" value="1.0.0" />
        <InfoCard title="الدعم الفني" value="01155559287" />
        <InfoCard title="المطور" value="بشمهندس عبدالرحمن حازم" />
        <InfoCard title="نوع البرنامج" value="Desktop ERP System" />
      </section>

      <section
        style={{
          background: 'rgba(15,23,42,0.55)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '18px',
          padding: '22px'
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>بيانات التواصل والدعم</h3>

        <div style={{ display: 'grid', gap: '10px', color: '#e5e7eb' }}>
          <div>
            <strong>الاسم:</strong> بشمهندس عبدالرحمن حازم
          </div>

          <div>
            <strong>الهاتف / واتساب:</strong> 01155559287/01068377869
          </div>

          <div>
            <strong>ملاحظات الدعم:</strong> عند حدوث مشكلة، يفضل إرسال صورة من الخطأ مع شرح الخطوات التي أدت للمشكلة.
          </div>
        </div>
      </section>

      <section
        style={{
          background: 'rgba(15,23,42,0.55)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '18px',
          padding: '22px'
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>ملاحظات مهمة</h3>

        <ul style={{ margin: 0, paddingRight: '20px', color: '#cbd5e1', lineHeight: 2 }}>
          <li>يُفضل عمل نسخة احتياطية من قاعدة البيانات بشكل دوري.</li>
          <li>لا تحذف ملفات البرنامج يدويًا من فولدر التثبيت.</li>
          <li>استخدم شاشة النسخ الاحتياطي والاسترجاع لحماية بياناتك.</li>
          <li>بعد أول تشغيل، يُفضل تغيير كلمة مرور المدير الافتراضية.</li>
        </ul>
      </section>
    </div>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: 'rgba(15,23,42,0.55)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding: '18px'
      }}
    >
      <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '8px' }}>
        {title}
      </div>

      <strong style={{ fontSize: '18px', color: '#fff' }}>
        {value}
      </strong>
    </div>
  );
}