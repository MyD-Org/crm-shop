/**
 * Mails del Botón de arrepentimiento: la copia al cliente y el aviso al
 * comercio. Puros (sin red): la server action los arma y los manda.
 *
 * Usa el layout común de `mail-layout.ts` (tarjeta de 440px, franja azul,
 * logo o nombre de la tienda, preheader oculto, pie con el comercio y el
 * link al sitio). Todo lo que tipea la persona pasa por `escapeHtml`.
 *
 * Texto: SOLO el trámite (código, datos, próximos pasos). Sin plazos ni
 * beneficios extra: el alcance legal está en /terminos y /arrepentimiento.
 */
import { escapeHtml as e } from "./escape-html";
import { FUENTE_MAIL, pieTexto, tarjetaMail } from "./mail-layout";

export interface MailArrepentimiento {
  subject: string;
  html: string;
  text: string;
}

type Fila = [etiqueta: string, valor: string];

/** Filas con valor: pedido y motivo son opcionales y no se muestran vacíos. */
function filas(lista: [string, string | undefined][]): Fila[] {
  return lista.filter((f): f is Fila => Boolean(f[1]));
}

function tablaDatos(datos: Fila[]): string {
  const celdas = datos
    .map(
      ([k, v]) => `
          <tr>
            <td style="padding:6px 0;font-size:13px;color:#77808a;vertical-align:top;width:120px">${e(k)}</td>
            <td style="padding:6px 0;font-size:14px;color:#1c2733;white-space:pre-wrap">${e(v)}</td>
          </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FUENTE_MAIL}">${celdas}
        </table>`;
}

/** Cuerpo propio de estos mails: título, bajada, código destacado y tabla de datos. */
function cuerpo(input: { titulo: string; bajada: string; codigo: string; datos: Fila[] }): string {
  const { titulo, bajada, codigo, datos } = input;
  return `
      <tr><td style="padding:20px 32px 0;font-family:${FUENTE_MAIL};color:#1c2733">
        <p style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:700">${e(titulo)}</p>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#77808a">${e(bajada)}</p>
      </td></tr>
      <tr><td style="padding:24px 32px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#e9f1fa;border:1px solid #d3e2f4;border-radius:10px">
          <tr><td align="center" style="padding:18px 16px">
            <div style="font-family:${FUENTE_MAIL};font-size:13px;line-height:1.4;color:#77808a;margin-bottom:8px">Código de la solicitud</div>
            <div style="font-family:${FUENTE_MAIL};font-size:28px;line-height:1;font-weight:700;letter-spacing:0.06em;color:#16283f;font-variant-numeric:tabular-nums;white-space:nowrap">${e(codigo)}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 32px 0">
        ${tablaDatos(datos)}
      </td></tr>`;
}

function textoPlano(lineas: string[], datos: Fila[]): string {
  return [...lineas, "", ...datos.map(([k, v]) => `${k}: ${v}`)].join("\n");
}

export function armarMailArrepentimientoCliente(i: {
  codigo: string;
  nombre: string;
  pedido?: string;
  motivo?: string;
  /** Nombre de la tienda para el encabezado y el asunto; sin él va uno genérico. */
  comercio?: string;
  /** null/ausente = sin logo: va el nombre en texto. */
  logoUrl?: string | null;
  /** `urlSitioMail()`: si está, el pie lleva un link al sitio. */
  sitioUrl?: string | null;
}): MailArrepentimiento {
  const encabezado = i.comercio || "Botón de arrepentimiento";
  const subject = `${encabezado} — Recibimos su solicitud de arrepentimiento ${i.codigo}`;
  const bajada = `Registramos su solicitud de revocación de compra con el código ${i.codigo}. Guárdelo para cualquier consulta.`;
  const pie = "El comercio se comunicará con usted para coordinar la devolución del producto. Si no realizó esta solicitud, responda a este mensaje.";
  const datos = filas([
    ["Nombre", i.nombre],
    ["Pedido", i.pedido],
    ["Motivo", i.motivo],
  ]);

  const html = tarjetaMail({
    preheader: `Código ${i.codigo}. El comercio se comunicará con usted.`,
    logoUrl: i.logoUrl,
    nombreComercio: encabezado,
    cuerpoHtml: cuerpo({ titulo: "Recibimos su solicitud", bajada, codigo: i.codigo, datos }),
    pie: [pie],
    sitioUrl: i.sitioUrl,
  });

  const text = textoPlano([bajada, ...pieTexto(encabezado, i.sitioUrl, [pie])], datos);
  return { subject, html, text };
}

/** "25/09/2026 12:30" en hora argentina (el servidor corre en UTC). */
function fechaAr(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(fecha)
    .replace(",", "");
}

export function armarMailArrepentimientoComercio(i: {
  codigo: string;
  nombre: string;
  email: string;
  telefono: string;
  pedido?: string;
  motivo?: string;
  fecha: Date;
  /** `urlSitioMail()`: si está, el pie lleva un link al sitio. */
  sitioUrl?: string | null;
}): MailArrepentimiento {
  const encabezado = "Botón de arrepentimiento";
  const subject = `Nueva solicitud de arrepentimiento ${i.codigo}`;
  const bajada = "Una persona pidió revocar su compra desde el Botón de arrepentimiento del sitio.";
  const pie = "Comuníquese con la persona para coordinar la devolución. Puede responder a este mensaje: la respuesta le llega a su email.";
  const datos = filas([
    ["Nombre", i.nombre],
    ["Email", i.email],
    ["Teléfono", i.telefono],
    ["Pedido", i.pedido],
    ["Motivo", i.motivo],
    ["Fecha", fechaAr(i.fecha)],
  ]);

  const html = tarjetaMail({
    preheader: `${i.codigo} de ${i.nombre}`,
    nombreComercio: encabezado,
    cuerpoHtml: cuerpo({ titulo: `Solicitud ${i.codigo}`, bajada, codigo: i.codigo, datos }),
    pie: [pie],
    sitioUrl: i.sitioUrl,
  });

  const text = textoPlano([`Solicitud ${i.codigo}.`, bajada, ...pieTexto(encabezado, i.sitioUrl, [pie])], datos);
  return { subject, html, text };
}
