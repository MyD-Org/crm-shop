// Portado de apps/admin/src/lib/receipt-email.ts (plantilla) y
// apps/admin/src/lib/receipt-delivery.ts (envío con lease), sólo el envío
// inicial: el reenvío sigue en el backoffice del CRM.
//
// Cambios respecto del CRM:
// - El botón "Ver en el backoffice" apunta a `CRM_ADMIN_URL` (env
//   server-only). NUNCA al origin del request: sería el Shop. Sin la variable
//   el mail sale sin botón.
// - Copy en usted y pie "Enviado desde Mi cuenta de la tienda".
// - Remitente `RECEIPTS_EMAIL_FROM` (dirección pelada, se arma el nombre) o,
//   si falta, `EMAIL_FROM` tal cual.
// - Envío por `enviarEmail` del Shop (Resend por HTTP).
//
// Todo dato del cliente pasa por escapeHtml y el asunto sale en una sola línea.

import { enviarEmail } from "../email";
import { extFor } from "./archivo";
import type { ComprobanteFila, ResultadoMail } from "./repo";
import { METHOD_LABELS } from "./validacion";

/** Tope de adjunto: 10 MiB. Más grande, el mail va sin archivo. */
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;

/** Prefijo fijo del asunto (el mismo que el portal: el backoffice filtra por esto). */
export const RECEIPT_EMAIL_SUBJECT_PREFIX = "[Comprobante de pago]";

const SUBJECT_MAX = 200;
const FROM_DISPLAY_NAME_MAX = 64;
const AR_TZ = "America/Argentina/Buenos_Aires";

/** Escape HTML completo (& < > " ') para todo dato del cliente o del tenant. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** CR/LF y controles ⇒ espacio (defensa contra header injection en el asunto). */
function oneLine(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `"Nombre" <dirección>` sin comillas ni ángulos en el nombre, ≤64. */
export function formatFromAddress(displayName: string, address: string): string {
  const name = displayName
    .replace(/["<>\r\n]/g, "")
    .trim()
    .slice(0, FROM_DISPLAY_NAME_MAX);
  return `"${name}" <${address}>`;
}

function formatAmountAr(amount: string): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(amount));
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

/** "2026-09-01" → "01/09/2026". */
function formatDate(isoDate: string): string {
  const [y = "", m = "", d = ""] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

/** Fecha y hora de Argentina. */
function formatSubmittedAt(d: Date): string {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Link al comprobante en el backoffice, o null sin `CRM_ADMIN_URL`. */
export function urlBackoffice(id: string, env: Record<string, string | undefined> = process.env): string | null {
  const base = env.CRM_ADMIN_URL?.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//.test(base)) return null;
  return `${base}/admin/comprobantes?id=${encodeURIComponent(id)}`;
}

export interface DatosMailComprobante {
  tenantName: string;
  receipt: {
    id: string;
    razonsocial: string;
    cuit: string;
    codigocliente: string;
    /** Decimal string ("150000.50"): sólo se formatea. */
    amount: string;
    paidOn: string;
    method: string;
    methodOther?: string | null;
    notes?: string | null;
    fileMime: string;
    fileSize: number;
    submittedAt: Date;
    convertedFrom?: string | null;
  };
  /** null = sin `CRM_ADMIN_URL`: el mail sale sin botón. */
  adminUrl: string | null;
  attachmentIncluded: boolean;
  /** Email del cliente (replyTo). Sólo con esto el pie invita a responderle. */
  clientEmail?: string | null;
  duplicateOf?: { id: string; submittedAt: Date } | null;
}

export function armarMailComprobante(input: DatosMailComprobante): { subject: string; html: string; text: string } {
  const { receipt: r, tenantName } = input;
  const e = escapeHtml;

  const methodLabel =
    r.method === "otro" && r.methodOther
      ? `Otro (${r.methodOther})`
      : (METHOD_LABELS[r.method as keyof typeof METHOD_LABELS] ?? r.method);

  const subject =
    `${RECEIPT_EMAIL_SUBJECT_PREFIX} ${oneLine(r.razonsocial)} — ${oneLine(formatAmountAr(r.amount))} — ${formatDate(r.paidOn)}`.slice(
      0,
      SUBJECT_MAX,
    );

  const sizeNote = input.attachmentIncluded
    ? "Va adjunto."
    : input.adminUrl
      ? `El archivo pesa ${formatMb(r.fileSize)} y no se adjunta: ábralo desde el backoffice.`
      : `El archivo pesa ${formatMb(r.fileSize)} y no se adjunta: búsquelo en Comprobantes del backoffice.`;
  const dupNote = input.duplicateOf
    ? `Posible duplicado de un comprobante del ${formatSubmittedAt(input.duplicateOf.submittedAt)} (mismo archivo, ya informado).`
    : "";
  const convertedNote = r.convertedFrom ? ` (convertido de ${e(r.convertedFrom)})` : "";
  const archivo = `${e(r.fileMime)} · ${formatMb(r.fileSize)}${convertedNote}`;
  const pie = `Enviado automáticamente desde Mi cuenta de la tienda de ${tenantName}.`;
  const replyNote = input.clientEmail
    ? `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #eef1f5">Responda este mail para escribirle al cliente.</p>`
    : "";
  const notesRow = r.notes
    ? `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Notas</td><td style="padding:6px 0">${e(r.notes)}</td></tr>`
    : "";
  const boton = input.adminUrl
    ? `<tr><td style="padding:20px 32px 28px">
        <a href="${e(input.adminUrl)}" style="display:inline-block;background:#1f8cff;color:#ffffff;text-decoration:none;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px">Ver en el backoffice</a>
      </td></tr>`
    : `<tr><td style="padding:12px 32px 0"></td></tr>`;

  // El mail se renderiza en clientes de correo: estilos inline, fuera del DS.
  const html = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef1f5;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:440px;background:#ffffff;border-radius:12px;border-top:3px solid #1f8cff">
      <tr><td style="padding:28px 32px 0">
        <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280">${e(tenantName)}</div>
      </td></tr>
      <tr><td style="padding:20px 32px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#111827">
        <p style="margin:0 0 16px;font-size:18px;font-weight:700">Comprobante de pago recibido</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:14px">
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;width:130px">Cliente</td><td style="padding:6px 0">${e(r.razonsocial)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">CUIT</td><td style="padding:6px 0">${e(r.cuit)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Código</td><td style="padding:6px 0">${e(r.codigocliente)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Monto</td><td style="padding:6px 0">${e(formatAmountAr(r.amount))}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Fecha del pago</td><td style="padding:6px 0">${formatDate(r.paidOn)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Medio</td><td style="padding:6px 0">${e(methodLabel)}</td></tr>
          ${notesRow}
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Informado el</td><td style="padding:6px 0">${formatSubmittedAt(r.submittedAt)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Archivo</td><td style="padding:6px 0">${archivo}</td></tr>
        </table>
        <p style="margin:16px 0 0">${e(sizeNote)}</p>
        ${dupNote ? `<p style="margin:8px 0 0;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;font-size:13px">${e(dupNote)}</p>` : ""}
      </td></tr>
      ${boton}
      <tr><td style="padding:0 32px 28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.55;color:#9ca3af">
        <p style="margin:0">${e(pie)}</p>
        ${replyNote}
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = [
    `Comprobante de pago recibido (${tenantName})`,
    ``,
    `Cliente: ${r.razonsocial}`,
    `CUIT: ${r.cuit}`,
    `Código: ${r.codigocliente}`,
    `Monto: ${formatAmountAr(r.amount)}`,
    `Fecha del pago: ${formatDate(r.paidOn)}`,
    `Medio: ${methodLabel}`,
    ...(r.notes ? [`Notas: ${r.notes}`] : []),
    `Informado el: ${formatSubmittedAt(r.submittedAt)}`,
    `Archivo: ${r.fileMime} · ${formatMb(r.fileSize)}${r.convertedFrom ? ` (convertido de ${r.convertedFrom})` : ""}`,
    ``,
    sizeNote,
    ...(dupNote ? [dupNote] : []),
    ...(input.adminUrl ? [``, `Ver en el backoffice: ${input.adminUrl}`] : []),
    ``,
    pie + (input.clientEmail ? " Responda este mail para escribirle al cliente." : ""),
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Envío (lease de 60 s + clave de idempotencia de Resend)
// ---------------------------------------------------------------------------

export type ResultadoAviso = ResultadoMail | { status: "in_progress" };

/** Subconjunto del repo que usa el envío (fakes en los tests). */
export interface RepoMail {
  tomarIntentoMail(tenantId: string, id: string, now: Date): Promise<number | null>;
  buscarPublicado(tenantId: string, id: string): Promise<ComprobanteFila | null>;
  registrarMail(tenantId: string, id: string, outcome: ResultadoMail, now: Date): Promise<void>;
}

export interface EntradaAviso {
  tenant: { id: string; nombre: string; mailComprobantes: string | null };
  id: string;
  /** Bytes publicados, ya en memoria: se adjuntan si entran en 10 MB. */
  buffer: Uint8Array;
  duplicateOf?: { id: string; submittedAt: Date } | null;
}

export interface DepsAviso {
  repo: RepoMail;
  env?: Record<string, string | undefined>;
  enviar?: typeof enviarEmail;
  now?: () => Date;
}

// Los tags de Resend sólo aceptan [A-Za-z0-9_-].
function tagValue(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "");
}

function looksLikeEmail(s: string | null): s is string {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

/** Remitente: `RECEIPTS_EMAIL_FROM` con el nombre armado, o `EMAIL_FROM` tal cual. */
function remitente(tenantName: string, env: Record<string, string | undefined>): string | null {
  const propio = env.RECEIPTS_EMAIL_FROM?.trim();
  if (propio) return formatFromAddress(`${tenantName} · Comprobantes`, propio);
  return env.EMAIL_FROM?.trim() || null;
}

/**
 * Manda el aviso al `receipts_email` del tenant y persiste el resultado en
 * `email_*`. Sin destino ⇒ `skipped` (el backoffice ya muestra el reenvío).
 */
export async function enviarAvisoComprobante(entrada: EntradaAviso, deps: DepsAviso): Promise<ResultadoAviso> {
  const { tenant, id, buffer, duplicateOf } = entrada;
  const { repo } = deps;
  const env = deps.env ?? process.env;
  const enviar = deps.enviar ?? enviarEmail;
  const now = deps.now ?? (() => new Date());

  // 1. Lease: sin fila ⇒ hay un envío en curso (o la fila no está publicada).
  const attempt = await repo.tomarIntentoMail(tenant.id, id, now());
  if (attempt === null) return { status: "in_progress" };

  const cerrar = async (outcome: ResultadoMail): Promise<ResultadoAviso> => {
    await repo.registrarMail(tenant.id, id, outcome, now());
    return outcome;
  };

  // 2. Configuración faltante ⇒ skipped.
  const to = tenant.mailComprobantes;
  if (!to) return cerrar({ status: "skipped", reason: "mail destino no configurado" });
  const from = remitente(tenant.nombre, env);
  if (!from) return cerrar({ status: "skipped", reason: "remitente no configurado" });

  const row = await repo.buscarPublicado(tenant.id, id);
  if (!row || !row.fileMime || !row.fileSize || !row.submittedAt) {
    return cerrar({ status: "failed", error: "comprobante no disponible" });
  }

  // 3. Adjunto sólo si entra en 10 MB.
  const filename = `comprobante-${row.paidOn}-${row.id.slice(0, 8)}.${extFor(row.fileMime)}`;
  const attachment =
    buffer.length <= ATTACH_MAX_BYTES ? { filename, content: buffer, contentType: row.fileMime } : undefined;

  // 4. Armado + envío.
  const clientEmail = looksLikeEmail(row.clientEmail) ? row.clientEmail : null;
  const email = armarMailComprobante({
    tenantName: tenant.nombre,
    receipt: {
      id: row.id,
      razonsocial: row.razonsocial,
      cuit: row.cuit,
      codigocliente: row.codigocliente,
      amount: row.amount,
      paidOn: row.paidOn,
      method: row.method,
      methodOther: row.methodOther,
      notes: row.notes,
      fileMime: row.fileMime,
      fileSize: row.fileSize,
      submittedAt: row.submittedAt,
      convertedFrom: row.convertedFrom,
    },
    adminUrl: urlBackoffice(row.id, env),
    attachmentIncluded: attachment !== undefined,
    clientEmail,
    duplicateOf: duplicateOf ?? null,
  });

  const enviado = await enviar({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    from,
    replyTo: clientEmail ?? undefined,
    attachments: attachment ? [attachment] : undefined,
    tags: [
      { name: "type", value: "payment_receipt" },
      { name: "tenant", value: tagValue(tenant.id) },
    ],
    idempotencyKey: `payment-receipt/${row.id}/${attempt}`,
  });
  if (enviado.ok) return cerrar({ status: "sent" });
  // Sin RESEND_API_KEY no es una falla del envío: skipped, como el dry-run del CRM.
  if (enviado.noConfigurado) return cerrar({ status: "skipped", reason: "servicio de correo no configurado" });
  return cerrar({ status: "failed", error: enviado.error ?? "No se pudo enviar el email" });
}
