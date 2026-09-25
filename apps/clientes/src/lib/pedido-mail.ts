/**
 * Mails al comprador sobre su pedido: "Recibimos su pedido" (al crearlo) y los del cobro en
 * línea ("Recibimos su pago" / "No pudimos procesar su pago"). Puros (sin red ni base): los
 * arma `pedido-avisos.ts` y los manda.
 *
 * Los cambios de estado y el pago offline los avisa el CRM, que es donde el operador los hace
 * (apps/admin/src/lib/pedido-estado-email.ts). Mismo esqueleto que `arrepentimiento-mail.ts`:
 * tarjeta de 440px, franja azul, logo o nombre de la tienda. Todo dato del comprador pasa por
 * `escapeHtml`, y el asunto sale en una sola línea.
 */
import { escapeHtml as e } from "./escape-html";

export interface MailPedido {
  subject: string;
  html: string;
  text: string;
}

export type AvisoPedidoShop = "recibido" | "pago_recibido" | "pago_rechazado";

export interface LineaMail {
  nombre: string;
  cantidad: number;
}

export interface DatosMailPedido {
  aviso: AvisoPedidoShop;
  /** "PED-00000042". */
  numero: string;
  contactoNombre: string;
  /** Nombre de la tienda para el encabezado y el asunto. */
  comercio: string;
  /** null = sin logo: va el nombre en texto. */
  logoUrl?: string | null;
  /** Link absoluto a "Mis pedidos". Sin él, el mail no lleva botón. */
  pedidosUrl?: string | null;
  /** Sólo "recibido": resumen del pedido. */
  lineas?: LineaMail[];
  total?: number;
  entrega?: string;
  pago?: string;
  /** Sólo "recibido": el pago en línea todavía no se completó. */
  pagoPendienteEnLinea?: boolean;
}

const FUENTE = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

function oneLine(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function moneda(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
}

function cantidad(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

const COPY: Record<AvisoPedidoShop, { asunto: string; titulo: string; bajada: (d: DatosMailPedido) => string }> = {
  recibido: {
    asunto: "recibido",
    titulo: "Recibimos su pedido",
    bajada: (d) =>
      d.pagoPendienteEnLinea
        ? "Registramos su pedido. Si todavía no completó el pago, puede hacerlo desde Mis pedidos. Le avisaremos por este medio cada vez que avance."
        : "Registramos su pedido. Le avisaremos por este medio cada vez que avance.",
  },
  pago_recibido: {
    asunto: "pago recibido",
    titulo: "Recibimos su pago",
    bajada: () => "Su pago fue aprobado. Le avisaremos cuando confirmemos su pedido.",
  },
  pago_rechazado: {
    asunto: "pago no procesado",
    titulo: "No pudimos procesar su pago",
    bajada: () =>
      "El pago de su pedido no se pudo completar y no se le cobró. Puede intentarlo nuevamente, con otra tarjeta o medio de pago, desde Mis pedidos.",
  },
};

function resumen(d: DatosMailPedido): string {
  const filas = (d.lineas ?? [])
    .map(
      (l) => `
          <tr>
            <td style="padding:4px 0;font-size:14px;color:#1c2733">${e(l.nombre)}</td>
            <td align="right" style="padding:4px 0 4px 12px;font-size:14px;color:#77808a;white-space:nowrap">× ${e(cantidad(l.cantidad))}</td>
          </tr>`,
    )
    .join("");
  const datos: [string, string | undefined][] = [
    ["Total", d.total !== undefined ? moneda(d.total) : undefined],
    ["Entrega", d.entrega],
    ["Pago", d.pago],
  ];
  const datosHtml = datos
    .filter((f): f is [string, string] => Boolean(f[1]))
    .map(
      ([k, v]) => `
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#77808a;width:90px">${e(k)}</td>
            <td style="padding:4px 0;font-size:14px;color:#1c2733">${e(v)}</td>
          </tr>`,
    )
    .join("");
  return `
      <tr><td style="padding:20px 32px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FUENTE};border-bottom:1px solid #eceae4;padding-bottom:8px">${filas}
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FUENTE};margin-top:8px">${datosHtml}
        </table>
      </td></tr>`;
}

export function armarMailPedido(d: DatosMailPedido): MailPedido {
  const copy = COPY[d.aviso];
  const bajada = copy.bajada(d);
  const nombre = d.contactoNombre.trim();
  const saludo = nombre ? `Hola, ${nombre}:` : "Hola:";
  const subject = `${oneLine(d.comercio)} — Pedido ${d.numero} ${copy.asunto}`.slice(0, 200);
  const conResumen = d.aviso === "recibido" && (d.lineas?.length ?? 0) > 0;

  const html = `
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${e(`${copy.titulo} · Pedido ${d.numero}`)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8f8f6;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:440px;background:#ffffff;border-radius:12px;border-top:3px solid #1e5aa8">
      <tr><td style="padding:28px 32px 0">
        ${
          d.logoUrl
            ? `<img src="${e(d.logoUrl)}" width="180" height="23" alt="${e(d.comercio)}" style="display:block;border:0;outline:none;text-decoration:none;height:23px;width:180px;font-family:${FUENTE};font-size:16px;font-weight:700;color:#1e5aa8">`
            : `<div style="font-family:${FUENTE};font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1e5aa8">${e(d.comercio)}</div>`
        }
      </td></tr>
      <tr><td style="padding:20px 32px 0;font-family:${FUENTE};color:#1c2733">
        <p style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:700">${e(copy.titulo)}</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.55">${e(saludo)}</p>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#77808a">${e(bajada)}</p>
        <p style="margin:12px 0 0;font-size:14px;color:#77808a">Pedido <strong style="color:#1c2733">${e(d.numero)}</strong></p>
      </td></tr>${conResumen ? resumen(d) : ""}
      <tr><td style="padding:24px 32px 28px;font-family:${FUENTE}">
        ${
          d.pedidosUrl
            ? `<a href="${e(d.pedidosUrl)}" style="display:inline-block;background:#1e5aa8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Ver mis pedidos</a>`
            : ""
        }
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const lineasTexto = conResumen
    ? [
        "",
        ...(d.lineas ?? []).map((l) => `- ${l.nombre} × ${cantidad(l.cantidad)}`),
        ...(d.total !== undefined ? [`Total: ${moneda(d.total)}`] : []),
        ...(d.entrega ? [`Entrega: ${d.entrega}`] : []),
        ...(d.pago ? [`Pago: ${d.pago}`] : []),
      ]
    : [];
  const text = [
    copy.titulo,
    "",
    saludo,
    bajada,
    "",
    `Pedido ${d.numero}`,
    ...lineasTexto,
    ...(d.pedidosUrl ? ["", `Ver mis pedidos: ${d.pedidosUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}
