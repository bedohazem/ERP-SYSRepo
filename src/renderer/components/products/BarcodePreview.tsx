import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

type BarcodePreviewProps = {
  value: string;
  width?: number;
  height?: number;
};

export default function BarcodePreview({
  value,
  width = 1.8,
  height = 50
}: BarcodePreviewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value?.trim()) return;

    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        displayValue: true,
        width,
        height,
        margin: 4,
        fontSize: 14
      });
    } catch (error) {
      console.error('Barcode render failed:', error);
    }
  }, [value, width, height]);

  if (!value?.trim()) {
    return <div style={{ color: '#94a3b8' }}>لا يوجد باركود</div>;
  }

  return <svg ref={svgRef} />;
}