// Portado de apps/admin/src/lib/receipt-file.ts (sin sanitizeFilename: el Shop
// no guarda el nombre original).
//
// El tipo real del comprobante se decide SÓLO por magic bytes: el content-type
// declarado y la extensión no otorgan confianza (un SVG disfrazado de PNG se
// rechaza igual). `procesarArchivo` es el único punto de extensión: convierte
// HEIC/HEIF a JPEG y re-encoda JPEG/PNG/WebP sin EXIF (imagen.ts); los PDF
// pasan sin tocar.

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/**
 * Clasifica los primeros ≤1024 bytes por firma. Devuelve el mime real o null
 * si no está en la lista admitida (SVG, HTML, ZIP/Office, texto, vacío…).
 */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  // WebP: "RIFF" + 4 bytes de tamaño + "WEBP".
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  // HEIC/HEIF: caja "ftyp" en offset 4 y major brand en 8..11.
  if (ascii(bytes, 4, 4) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 4))) {
    const brand = ascii(bytes, 8, 4);
    return brand === "mif1" || brand === "msf1" ? "image/heif" : "image/heic";
  }
  // PDF: la spec tolera basura antes del header; se busca en el primer KB.
  const limit = Math.min(bytes.length, 1024) - PDF_MAGIC.length;
  for (let i = 0; i <= limit; i++) {
    if (startsWith(bytes, PDF_MAGIC, i)) return "application/pdf";
  }
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Extensión según el mime REAL (sniffeado o convertido), nunca el declarado. */
export function extFor(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

export interface ArchivoProcesado {
  bytes: Uint8Array;
  mime: string;
  /** Mime de origen cuando el archivo se convirtió (HEIC→JPEG, sin EXIF); null si quedó igual. */
  convertedFrom: string | null;
}

/**
 * PDF: passthrough byte a byte. Imágenes: normalización de imagen.ts. El
 * import es dinámico para no cargar sharp/heic-decode donde no hace falta.
 */
export async function procesarArchivo(bytes: Uint8Array, mime: string): Promise<ArchivoProcesado> {
  if (mime === "application/pdf") return { bytes, mime, convertedFrom: null };
  const { normalizarImagen } = await import("./imagen");
  const out = await normalizarImagen(bytes, mime);
  return { bytes: out.bytes, mime: out.mime, convertedFrom: out.mime === mime ? null : mime };
}
