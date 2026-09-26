/**
 * Layout HTML común a los mails del Shop: documento completo, tarjeta de
 * 440px, franja de color arriba, logo o nombre del comercio, preheader
 * oculto y pie con el comercio, el link al sitio y el aviso de automático.
 *
 * Antes cada mail (`pedido-mail.ts`, `comprobantes/mail.ts`,
 * `arrepentimiento-mail.ts`, `vinculacion-mail.ts`) repetía este esqueleto a
 * mano; ahora sólo arman su `cuerpoHtml` (título, bajada, tablas, botón) y
 * llaman a `tarjetaMail`.
 *
 * Se renderiza en clientes de correo: tablas + estilos inline (nada de CSS
 * externo ni flexbox), documento HTML completo (Gmail/Outlook reescriben un
 * fragmento suelto de forma menos previsible que un documento propio),
 * `color-scheme`/`supported-color-schemes` para que no se oscurezca solo en
 * modo oscuro, y ancho fluido (`width="100%"` + `max-width`) para mobile.
 *
 * Todo dato variable pasa por `escapeHtml` ANTES de llegar a `cuerpoHtml` o
 * `pie`: este módulo no vuelve a escapar ese HTML ya armado (lo trataría como
 * texto), salvo `preheader`, `nombreComercio` y las líneas de `pie`, que
 * llegan en texto plano y sí se escapan acá.
 */
import { escapeHtml as e } from "./escape-html";

export const FUENTE_MAIL = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

/** Franja y acentos por defecto: azul de la tienda (tema "calido-azul" del DS). */
export const COLOR_FRANJA_DEFAULT = "#1e5aa8";

/** Ancho de la tarjeta: el `width`/`height` del logo van a este tamaño (2x = 360×46 en el PNG). */
const ANCHO_LOGO = 180;
const ALTO_LOGO = 23;

/**
 * URL absoluta a la raíz del sitio (`NEXT_PUBLIC_SITE_URL`), sin barra final,
 * o `null` sin la variable o con un valor inválido. Un mail no puede usar
 * rutas relativas ni la URL de producción escrita en el repo.
 */
export function urlSitioMail(sitio = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  if (!sitio) return null;
  try {
    return new URL("/", sitio).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export interface TarjetaMailInput {
  /** Texto oculto que se ve en la bandeja sin abrir el mail. Texto plano: se escapa acá. */
  preheader: string;
  /** null/ausente = sin logo: va el nombre del comercio en texto. */
  logoUrl?: string | null;
  /** Nombre del comercio: sobretítulo (sin logo), `alt` de la imagen y primera línea del pie. */
  nombreComercio: string;
  /** Color de la franja superior y del sobretítulo/logo en texto. */
  colorFranja?: string;
  /** Color de fondo, fuera de la tarjeta blanca. */
  colorFondo?: string;
  /**
   * Contenido propio del mail (título, bajada, tablas, botón), ya armado en
   * filas `<tr><td>...</td></tr>` con sus datos escapados. Se inserta tal cual.
   */
  cuerpoHtml: string;
  /** Líneas propias del mail para el pie (avisos, "responda este mail", etc), en texto plano. */
  pie?: string[];
  /** `urlSitioMail()`: si está, el pie lleva un link al sitio. */
  sitioUrl?: string | null;
}

function encabezadoHtml(nombreComercio: string, logoUrl: string | null | undefined, colorFranja: string): string {
  if (logoUrl) {
    return `<img src="${e(logoUrl)}" width="${ANCHO_LOGO}" height="${ALTO_LOGO}" alt="${e(nombreComercio)}" style="display:block;border:0;outline:none;text-decoration:none;height:${ALTO_LOGO}px;width:${ANCHO_LOGO}px;max-width:${ANCHO_LOGO}px;font-family:${FUENTE_MAIL};font-size:16px;font-weight:700;color:${colorFranja}">`;
  }
  return `<div style="font-family:${FUENTE_MAIL};font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${colorFranja}">${e(nombreComercio)}</div>`;
}

function pieHtml(nombreComercio: string, sitioUrl: string | null | undefined, pie: string[]): string {
  const propio = pie.map((linea) => `<p style="margin:0 0 8px">${e(linea)}</p>`).join("");
  const sitio = sitioUrl
    ? ` · <a href="${e(sitioUrl)}" style="color:#77808a;text-decoration:underline">${e(sitioUrl.replace(/^https?:\/\//, ""))}</a>`
    : "";
  return `
      <tr><td style="padding:20px 32px 28px;font-family:${FUENTE_MAIL};font-size:12px;line-height:1.55;color:#9aa3ad;border-top:1px solid #eceae4">
        ${propio}
        <p style="margin:0">${e(nombreComercio)}${sitio}</p>
        <p style="margin:4px 0 0">Este es un mensaje automático.</p>
      </td></tr>`;
}

/** Tarjeta común: envuelve `cuerpoHtml` con el encabezado, el pie y el documento completo. */
export function tarjetaMail(input: TarjetaMailInput): string {
  const { preheader, logoUrl, nombreComercio, cuerpoHtml, sitioUrl } = input;
  const colorFranja = input.colorFranja ?? COLOR_FRANJA_DEFAULT;
  const colorFondo = input.colorFondo ?? "#f8f8f6";
  const pie = input.pie ?? [];

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(nombreComercio)}</title>
</head>
<body style="margin:0;padding:0;background:${colorFondo}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${e(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${colorFondo};padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:440px;background:#ffffff;border-radius:12px;border-top:3px solid ${colorFranja}">
      <tr><td style="padding:28px 32px 0">
        ${encabezadoHtml(nombreComercio, logoUrl, colorFranja)}
      </td></tr>
${cuerpoHtml}${pieHtml(nombreComercio, sitioUrl, pie)}
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Pie en texto plano: mismas tres piezas que `pieHtml`, para la versión sin HTML. */
export function pieTexto(nombreComercio: string, sitioUrl: string | null | undefined, pie: string[] = []): string[] {
  return [...pie, sitioUrl ? `${nombreComercio} · ${sitioUrl}` : nombreComercio, "Este es un mensaje automático."];
}
