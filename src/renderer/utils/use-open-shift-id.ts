import { useEffect, useState } from 'react';

export function useOpenShiftId() {
  const [openShiftId, setOpenShiftId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function refreshShift() {
      try {
        const shift = await window.api.getOpenCashShift();

        if (mounted) {
          setOpenShiftId(Number(shift?.id || 0) || null);
        }
      } catch {
        if (mounted) {
          setOpenShiftId(null);
        }
      }
    }

    void refreshShift();

    // نحدث الشيفت عند الرجوع للبرنامج.
    window.addEventListener('focus', refreshShift);

    return () => {
      mounted = false;
      window.removeEventListener('focus', refreshShift);
    };
  }, []);

  return openShiftId;
}
