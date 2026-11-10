import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * QR code drawn as one SVG path (no HTML injection). Generated in the browser: the encoded URL
 * never leaves the device. Error correction "M" survives a scuffed sticker.
 */
export function QrCode({ value, size = 160, label }: { value: string; size?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 4},${r + 4}h1v1h-1z`;
    return { d: path, n: count + 8 }; // 4-module quiet zone on every side
  }, [value]);
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Absolute URL a QR sticker points to (opens the item card after sign-in). */
export const qrUrl = (itemId: string) => `${window.location.origin}/q/${itemId}`;
