import { useEffect, useState } from 'react';

/**
 * يتغير الرقم بعد حفظ أي تعديل في كتالوج المنتجات.
 * لا يحدث بيانات الفواتير أو الأسعار بنفسه.
 * كل شاشة تستخدمه لإعادة قراءة البيانات المناسبة لها.
 */
export function useCatalogVersion() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return window.api.onProductCatalogChanged(() => {
      setVersion((current) => current + 1);
    });
  }, []);

  return version;
}
