/**
 * Allow-list of attachment types, detected from file *content* (magic bytes), not from the
 * client-supplied MIME type. The declared extension must also agree with the detected type.
 */
export interface DetectedType {
  mime: string;
  ext: string;
}

const EXT_ALIASES: Record<string, string[]> = {
  pdf: ['pdf'],
  png: ['png'],
  jpg: ['jpg', 'jpeg'],
  webp: ['webp'],
  docx: ['docx'],
  xlsx: ['xlsx'],
};

export const ALLOWED_EXTENSIONS = Object.values(EXT_ALIASES).flat();

const startsWith = (buf: Buffer, sig: number[], offset = 0) => sig.every((b, i) => buf[offset + i] === b);

export function detectType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' }; // %PDF-
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', ext: 'webp' };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML is a ZIP; entry names are stored in plain text in local file headers.
    const text = buf.toString('latin1');
    if (text.includes('vbaProject.bin')) return null; // macro-enabled documents are rejected
    if (!text.includes('[Content_Types].xml')) return null;
    if (text.includes('word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    if (text.includes('xl/')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  }
  return null;
}

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(filename);
  return m ? m[1]!.toLowerCase() : '';
}

export function extensionMatches(detected: DetectedType, filename: string): boolean {
  return (EXT_ALIASES[detected.ext] ?? []).includes(extensionOf(filename));
}

/** Display-safe original name: no path components or control characters, bounded length. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').replace(/^\.+/, '').trim();
  return (clean || 'file').slice(-200);
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
