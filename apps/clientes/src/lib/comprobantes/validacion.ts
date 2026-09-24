// Portado de apps/admin/src/lib/receipt-validation.ts (sin parseReceiptsEmail,
// que es del backoffice). Módulo puro: lo usan la API y el formulario.
//
// Validación del body del init de "Informar pago". Sin librería de schema: el
// body es chico y los errores van por campo, en usted y mostrables (los pinta
// el formulario). Mismas reglas que el portal del CRM (CMP-1).

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20971520
export const UPLOAD_URL_TTL_SECONDS = 600;
export const CONFIRM_LEASE_SECONDS = 120;
export const EMAIL_LEASE_SECONDS = 60;
export const RECEIPTS_HOURLY_LIMIT = 10;
export const RECEIPTS_DAILY_LIMIT = 20;
export const MAX_AMOUNT = 999999999999.99;
export const MAX_NOTES_CHARS = 500;
export const MAX_METHOD_OTHER_CHARS = 80;
export const MAX_FILE_NAME_CHARS = 255;
export const PAID_ON_MAX_AGE_YEARS = 2;

/** Tipos que el cliente puede declarar en el init. Sólo sirven para firmar el
 * PUT: la confianza la da el sniff de magic bytes en el confirm. */
export const DECLARED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const METHODS = ["transferencia", "cheque", "efectivo", "otro"] as const;
export type ReceiptMethod = (typeof METHODS)[number];

export const METHOD_LABELS: Record<ReceiptMethod, string> = {
  transferencia: "Transferencia",
  cheque: "Cheque",
  efectivo: "Efectivo",
  otro: "Otro",
};

/** Mensajes por campo (los comparten la API y el formulario). */
export const MENSAJES_CAMPO = {
  amount: "Ingrese un monto mayor a cero (hasta dos decimales).",
  paidOn: "Indique una fecha de pago de los últimos dos años, que no sea futura.",
  method: "Seleccione el medio de pago.",
  methodOther: "Indique el medio de pago.",
  methodOtherLargo: `El detalle no puede superar los ${MAX_METHOD_OTHER_CHARS} caracteres.`,
  notes: `Las notas no pueden superar los ${MAX_NOTES_CHARS} caracteres.`,
  file: "Seleccione el archivo del comprobante.",
  fileInvalido: "El archivo no es válido. Elija otro.",
  fileTipo: "El tipo de archivo no es válido. Suba un PDF o una imagen (JPG, PNG, WebP o HEIC).",
  fileVacio: "El archivo está vacío.",
  fileGrande: "El archivo supera el máximo de 20 MB.",
} as const;

const AR_TZ = "America/Argentina/Buenos_Aires";

/** "YYYY-MM-DD" de una fecha en la zona horaria Argentina (la del negocio). */
export function arYmd(d: Date): string {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Acepta string o number. Rechaza 0, negativos, > 999999999999.99 y más de
 * 2 decimales. Devuelve el monto normalizado ("150000.5" → "150000.50"). */
export function parseAmount(input: unknown): string | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [intPart = "", decPart = ""] = s.split(".");
  if (intPart.length > 12) return null;
  const value = Number(s);
  if (!(value > 0) || value > MAX_AMOUNT) return null;
  return decPart ? `${intPart}.${decPart.padEnd(2, "0")}` : intPart;
}

/**
 * Monto tal como lo escribe una persona en Argentina → decimal con punto:
 * "12.345,67" / "12345,67" / "150.000" → "12345.67" / "12345.67" / "150000".
 * Un punto con 3 dígitos después es separador de miles; si no, decimal.
 * Portado de apps/admin/src/components/portal/InformarPagoModal.tsx.
 */
export function normalizarMonto(raw: string): string | null {
  let s = raw.trim().replace(/\s+/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = s.split(".");
    if (partes.length > 1 && partes[partes.length - 1].length === 3 && partes.every((p) => /^\d+$/.test(p))) {
      s = partes.join("");
    }
  }
  return /^\d+(\.\d{1,2})?$/.test(s) ? s : null;
}

/**
 * `paidOn` "YYYY-MM-DD" no futura (hoy de Argentina, no UTC: a las 23:30 de
 * Argentina "mañana" todavía es futuro) ni anterior a hoy − 2 años.
 */
export function isValidPaidOn(paidOn: unknown, now: Date): boolean {
  if (typeof paidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return false;
  const [y, m, d] = paidOn.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return false; // fecha de calendario inválida (p. ej. 2026-02-30)
  }
  const today = arYmd(now);
  if (paidOn > today) return false;
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const min = `${ty - PAID_ON_MAX_AGE_YEARS}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
  return paidOn >= min;
}

/** Tipo declarado del archivo: el del navegador o, si viene vacío (HEIC en
 * algunos navegadores), el de la extensión. "" = no admitido. */
export function tipoDeclarado(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const nombre = file.name.toLowerCase();
  if (nombre.endsWith(".pdf")) return "application/pdf";
  if (nombre.endsWith(".png")) return "image/png";
  if (nombre.endsWith(".jpg") || nombre.endsWith(".jpeg")) return "image/jpeg";
  if (nombre.endsWith(".webp")) return "image/webp";
  if (nombre.endsWith(".heic")) return "image/heic";
  if (nombre.endsWith(".heif")) return "image/heif";
  return "";
}

export interface ParsedInit {
  amount: string;
  paidOn: string;
  method: ReceiptMethod;
  methodOther: string | null;
  notes: string | null;
  file: { name: string; size: number; contentType: string };
}

export type InitValidation =
  | { ok: true; value: ParsedInit }
  | { ok: false; status: 400; fields: Record<string, string> }
  | { ok: false; status: 413; code: "file_too_large"; error: string }
  | { ok: false; status: 415; code: "unsupported_type"; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Valida el body del init. Devuelve el valor parseado o el error con su status
 * HTTP. Precedencia: 400 (campos) → 415 (tipo declarado) → 413 (tamaño).
 */
export function parseInitBody(body: unknown, now: Date): InitValidation {
  const b = isRecord(body) ? body : {};
  const fields: Record<string, string> = {};

  const amount = parseAmount(b.amount);
  if (amount === null) fields.amount = MENSAJES_CAMPO.amount;

  if (!isValidPaidOn(b.paidOn, now)) fields.paidOn = MENSAJES_CAMPO.paidOn;

  const method = METHODS.find((m) => m === b.method);
  if (!method) fields.method = MENSAJES_CAMPO.method;

  let methodOther: string | null = null;
  if (method === "otro") {
    if (typeof b.methodOther !== "string" || b.methodOther.trim().length === 0) {
      fields.methodOther = MENSAJES_CAMPO.methodOther;
    } else if (b.methodOther.trim().length > MAX_METHOD_OTHER_CHARS) {
      fields.methodOther = MENSAJES_CAMPO.methodOtherLargo;
    } else {
      methodOther = b.methodOther.trim();
    }
  }

  let notes: string | null = null;
  if (b.notes !== undefined) {
    if (typeof b.notes !== "string" || b.notes.length > MAX_NOTES_CHARS) {
      fields.notes = MENSAJES_CAMPO.notes;
    } else {
      notes = b.notes.trim() || null;
    }
  }

  const file = isRecord(b.file) ? b.file : null;
  let fileName: string | null = null;
  let fileSize: number | null = null;
  let contentType: string | null = null;
  if (!file) {
    fields.file = MENSAJES_CAMPO.file;
  } else {
    if (typeof file.name !== "string" || file.name.length === 0 || file.name.length > MAX_FILE_NAME_CHARS) {
      fields.file = MENSAJES_CAMPO.fileInvalido;
    } else {
      fileName = file.name;
    }
    if (typeof file.size !== "number" || !Number.isInteger(file.size)) {
      fields.file = MENSAJES_CAMPO.fileInvalido;
    } else {
      fileSize = file.size;
    }
    if (typeof file.contentType !== "string") {
      fields.file = MENSAJES_CAMPO.fileInvalido;
    } else {
      contentType = file.contentType;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, status: 400, fields };

  // HEIC/HEIF entran: el confirm los convierte a JPEG.
  if (!(DECLARED_CONTENT_TYPES as readonly string[]).includes(contentType as string)) {
    return { ok: false, status: 415, code: "unsupported_type", error: MENSAJES_CAMPO.fileTipo };
  }
  if ((fileSize as number) <= 0 || (fileSize as number) > MAX_FILE_BYTES) {
    return { ok: false, status: 413, code: "file_too_large", error: MENSAJES_CAMPO.fileGrande };
  }

  return {
    ok: true,
    value: {
      amount: amount as string,
      paidOn: b.paidOn as string,
      method: method as ReceiptMethod,
      methodOther,
      notes,
      file: { name: fileName as string, size: fileSize as number, contentType: contentType as string },
    },
  };
}
