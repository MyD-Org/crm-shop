/**
 * Mail «Volvió a estar disponible» del aviso de reingreso. Puro (sin red): el cron lo arma y lo manda
 * con `enviarEmail`. Usa el layout común (`mail-layout.ts`); todo dato variable pasa por `escapeHtml`.
 * Texto en usted. Lleva el enlace de baja en el pie y las cabeceras `List-Unsubscribe` y
 * `List-Unsubscribe-Post` (RFC 8058, baja de un clic). No incluye datos de otras personas.
 */
import { escapeHtml as e } from "./escape-html";
import { MAIL } from "./aviso-reingreso-textos";
import { FUENTE_MAIL, pieTexto, tarjetaMail } from "./mail-layout";

export interface MailAviso {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** Enlace a la página de baja (confirma con un botón) y al endpoint de un clic. */
export function enlacesBaja(sitio: string, token: string): { pagina: string; unClic: string } {
  const t = encodeURIComponent(token);
  return { pagina: `${sitio}/baja-aviso/${t}`, unClic: `${sitio}/api/aviso-reingreso/baja?token=${t}` };
}

export function armarMailAviso(i: {
  /** Nombre del producto (con la opción, si es una variante). */
  nombreProducto: string;
  /** Ficha absoluta del producto (de la variante, si la hay). */
  urlProducto: string;
  /** URL absoluta de la raíz del sitio (`urlSitioMail()`), sin barra final. */
  sitioUrl: string;
  tokenBaja: string;
  comercio: string;
  logoUrl?: string | null;
}): MailAviso {
  const { pagina, unClic } = enlacesBaja(i.sitioUrl, i.tokenBaja);
  const bajada = MAIL.bajada(i.nombreProducto);

  const cuerpoHtml = `
      <tr><td style="padding:20px 32px 0;font-family:${FUENTE_MAIL};color:#1c2733">
        <p style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:700">${e(MAIL.titulo)}</p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#1c2733">${e(bajada)}</p>
        <p style="margin:0;font-size:14px;line-height:1.55;color:#77808a">${e(MAIL.aclaracion)}</p>
      </td></tr>
      <tr><td align="center" style="padding:24px 32px 0">
        <a href="${e(i.urlProducto)}" style="display:inline-block;background:#1e5aa8;color:#ffffff;font-family:${FUENTE_MAIL};font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px">${e(MAIL.boton)}</a>
      </td></tr>
      <tr><td style="padding:16px 32px 0;font-family:${FUENTE_MAIL};font-size:12px;line-height:1.55;color:#77808a">
        ${e(MAIL.pieBaja)} <a href="${e(pagina)}" style="color:#77808a;text-decoration:underline">${e(pagina.replace(/^https?:\/\//, ""))}</a>
      </td></tr>`;

  const html = tarjetaMail({
    preheader: MAIL.preheader(i.nombreProducto),
    logoUrl: i.logoUrl,
    nombreComercio: i.comercio,
    cuerpoHtml,
    pie: [MAIL.pieMotivo, MAIL.pieUnaVez],
    sitioUrl: i.sitioUrl,
  });

  const text = [
    MAIL.titulo,
    "",
    bajada,
    MAIL.aclaracion,
    "",
    `${MAIL.boton}: ${i.urlProducto}`,
    "",
    `${MAIL.pieBaja} ${pagina}`,
    "",
    ...pieTexto(i.comercio, i.sitioUrl, [MAIL.pieMotivo, MAIL.pieUnaVez]),
  ].join("\n");

  return {
    subject: MAIL.asunto(i.nombreProducto),
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unClic}>, <${pagina}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
