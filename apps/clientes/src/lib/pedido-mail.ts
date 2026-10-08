/**
 * Mails al comprador sobre su pedido: "Recibimos su pedido" (al crearlo, sólo en medios sin cobro
 * en línea) y los del cobro en línea: "Recibimos su pedido y su pago" (al aprobarse, es el único
 * mail de confirmación de esos pedidos) y "No pudimos procesar su pago". Puros (sin red ni base): los
 * arma `pedido-avisos.ts` y los manda.
 *
 * Los cambios de estado y el pago offline los avisa el CRM, que es donde el operador los hace
 * (apps/admin/src/lib/pedido-estado-email.ts). Usa el layout común de `mail-layout.ts` (tarjeta
 * de 440px, franja azul, logo o nombre de la tienda, pie con el comercio y el link al sitio).
 * Todo dato del comprador pasa por `escapeHtml`, y el asunto sale en una sola línea.
 */
import { escapeHtml as e } from "./escape-html";
import { FUENTE_MAIL, pieTexto, tarjetaMail } from "./mail-layout";
import { textoPagaConMedio } from "./medios-pago";
import { SLUG_TRANSFERENCIA, type CuentaPagoSnapshot } from "./cuentas-bancarias";
import { TEXTO_PLAZO_COMPROBANTE } from "./comprobantes/pedido";

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
  /** Sólo "pago_rechazado": link absoluto al checkout para reintentar el pago o elegir otro medio. */
  checkoutUrl?: string | null;
  /** `urlSitioMail()`: si está, el pie lleva un link al sitio. */
  sitioUrl?: string | null;
  /** "recibido" y "pago_recibido": resumen del pedido. */
  lineas?: LineaMail[];
  total?: number;
  entrega?: string;
  pago?: string;
  /**
   * "pago_recibido" en cuotas con interés del procesador: lo que pagó el comprador (informativo; el
   * total del pedido y la factura quedan al precio de 1 pago).
   */
  pagado?: { total: number; cuotas: number };
  /** Sólo "recibido": el pedido es de una cuenta corriente y `pago` es el nombre de su medio. */
  pagoCuentaCorriente?: boolean;
  /**
   * "recibido" y "pago_recibido": plazo de contacto (mensaje ya resuelto).
   */
  contacto?: { mensaje: string };
  /**
   * Sólo "recibido" y sólo si el pedido es por transferencia: la cuenta congelada en el pedido
   * (`orders.pago_cuenta`). `cuenta: null` = sin cuenta aplicable: mensaje neutro, sin datos.
   */
  transferencia?: { cuenta: CuentaPagoSnapshot | null };
}

/**
 * El bloque de la cuenta del mail "recibido": sólo si el pedido es por transferencia. Con snapshot
 * lleva los datos congelados; sin snapshot (sin cuenta aplicable o pedido anterior), el mensaje neutro.
 */
export function transferenciaParaMail(
  pagoMetodo: string,
  pagoCuenta: CuentaPagoSnapshot | null | undefined,
): { cuenta: CuentaPagoSnapshot | null } | undefined {
  return pagoMetodo === SLUG_TRANSFERENCIA ? { cuenta: pagoCuenta ?? null } : undefined;
}

/** Mismo texto que `CuentaTransferencia` del checkout (no se importa: eso es un componente). */
const TEXTO_SIN_CUENTA = "Le enviaremos los datos para transferir";

/** Filas de la cuenta, sin los datos vacíos. */
function filasCuenta(c: CuentaPagoSnapshot, total: number | undefined): [string, string][] {
  const filas: [string, string][] = [
    ["Alias", c.alias],
    ["CBU", c.cbu],
    ["Banco", c.banco],
    ["Titular", c.titular],
    ["CUIT", c.cuit],
  ];
  if (total !== undefined) filas.push(["Importe", moneda(total)]);
  return filas.filter(([, v]) => v.trim() !== "");
}

function bloqueTransferenciaHtml(t: { cuenta: CuentaPagoSnapshot | null }, total: number | undefined): string {
  const interior = t.cuenta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FUENTE_MAIL};margin-top:6px">${filasCuenta(
        t.cuenta,
        total,
      )
        .map(
          ([k, v]) => `
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#77808a;width:90px">${e(k)}</td>
            <td style="padding:4px 0;font-size:14px;color:#1c2733">${e(v)}</td>
          </tr>`,
        )
        .join("")}
        </table>
        <p style="margin:10px 0 0;font-size:14px;line-height:1.55;color:#1c2733">${e(TEXTO_PLAZO_COMPROBANTE)}</p>`
    : `<p style="margin:6px 0 0;font-size:14px;line-height:1.55;color:#77808a">${e(TEXTO_SIN_CUENTA)}</p>`;
  return `
      <tr><td style="padding:20px 32px 0;font-family:${FUENTE_MAIL};color:#1c2733">
        <p style="margin:0;font-size:15px;font-weight:700">Datos para transferir</p>${interior}
      </td></tr>`;
}

function bloqueTransferenciaTexto(t: { cuenta: CuentaPagoSnapshot | null }, total: number | undefined): string[] {
  return [
    "",
    "Datos para transferir",
    ...(t.cuenta
      ? [...filasCuenta(t.cuenta, total).map(([k, v]) => `${k}: ${v}`), "", TEXTO_PLAZO_COMPROBANTE]
      : [TEXTO_SIN_CUENTA]),
  ];
}

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
      d.pagoCuentaCorriente && d.pago
        ? `Registramos su pedido. ${textoPagaConMedio(d.pago)} Le avisaremos por este medio cada vez que avance.`
        : "Registramos su pedido. Le avisaremos por este medio cada vez que avance.",
  },
  pago_recibido: {
    asunto: "y pago recibidos",
    titulo: "Recibimos su pedido y su pago",
    bajada: () =>
      "Registramos su pedido y su pago fue aprobado. Le avisaremos por este medio cada vez que avance.",
  },
  pago_rechazado: {
    asunto: "pago no procesado",
    titulo: "No pudimos procesar su pago",
    bajada: () =>
      "El pago de su pedido no se pudo completar y no se le cobró. Puede reintentar el pago o elegir otro medio de pago; su pedido sigue registrado.",
  },
};

/** "$66.000 en 6 cuotas": sólo si pagó en cuotas más que el total del pedido (interés del procesador). */
function textoPagado(d: DatosMailPedido): string | undefined {
  const p = d.pagado;
  if (!p || p.cuotas < 2 || d.total === undefined || p.total <= d.total + 0.01) return undefined;
  return `${moneda(p.total)} en ${p.cuotas} cuotas`;
}

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
    ["Pagado", textoPagado(d)],
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
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FUENTE_MAIL};border-bottom:1px solid #eceae4;padding-bottom:8px">${filas}
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FUENTE_MAIL};margin-top:8px">${datosHtml}
        </table>
      </td></tr>`;
}

export function armarMailPedido(d: DatosMailPedido): MailPedido {
  const copy = COPY[d.aviso];
  const bajada = copy.bajada(d);
  const nombre = d.contactoNombre.trim();
  const saludo = nombre ? `Hola, ${nombre}:` : "Hola:";
  const subject = `${oneLine(d.comercio)} — Pedido ${d.numero} ${copy.asunto}`.slice(0, 200);
  const conResumen = d.aviso !== "pago_rechazado" && (d.lineas?.length ?? 0) > 0;
  const transferencia = d.aviso === "recibido" ? d.transferencia : undefined;
  // Con transferencia el mail ya dice qué hacer (datos y plazo del comprobante): sin plazo de contacto
  // igual que la pantalla del checkout.
  const contacto = d.aviso !== "pago_rechazado" && !transferencia ? d.contacto : undefined;
  const reintento = d.aviso === "pago_rechazado" ? d.checkoutUrl : undefined;

  const cuerpoHtml = `
      <tr><td style="padding:20px 32px 0;font-family:${FUENTE_MAIL};color:#1c2733">
        <p style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:700">${e(copy.titulo)}</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.55">${e(saludo)}</p>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#77808a">${e(bajada)}</p>
        ${
          contacto
            ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.55;white-space:pre-line">${e(contacto.mensaje)}</p>`
            : ""
        }
        <p style="margin:12px 0 0;font-size:14px;color:#77808a">Pedido <strong style="color:#1c2733">${e(d.numero)}</strong></p>
      </td></tr>${conResumen ? resumen(d) : ""}${transferencia ? bloqueTransferenciaHtml(transferencia, d.total) : ""}
      <tr><td style="padding:24px 32px 28px;font-family:${FUENTE_MAIL}">
        ${
          reintento
            ? `<a href="${e(reintento)}" style="display:inline-block;background:#1e5aa8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Reintentar el pago</a>${
                d.pedidosUrl
                  ? ` <a href="${e(d.pedidosUrl)}" style="display:inline-block;color:#1e5aa8;text-decoration:underline;font-size:14px;font-weight:600;padding:10px 12px">Ver mis pedidos</a>`
                  : ""
              }`
            : d.pedidosUrl
            ? `<a href="${e(d.pedidosUrl)}" style="display:inline-block;background:#1e5aa8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Ver mis pedidos</a>`
            : ""
        }
      </td></tr>`;

  const html = tarjetaMail({
    preheader: `${copy.titulo} · Pedido ${d.numero}`,
    logoUrl: d.logoUrl,
    nombreComercio: d.comercio,
    cuerpoHtml,
    sitioUrl: d.sitioUrl,
  });

  const lineasTexto = conResumen
    ? [
        "",
        ...(d.lineas ?? []).map((l) => `- ${l.nombre} × ${cantidad(l.cantidad)}`),
        ...(d.total !== undefined ? [`Total: ${moneda(d.total)}`] : []),
        ...(textoPagado(d) ? [`Pagado: ${textoPagado(d)}`] : []),
        ...(d.entrega ? [`Entrega: ${d.entrega}`] : []),
        ...(d.pago ? [`Pago: ${d.pago}`] : []),
      ]
    : [];
  const text = [
    copy.titulo,
    "",
    saludo,
    bajada,
    ...(contacto ? ["", contacto.mensaje] : []),
    "",
    `Pedido ${d.numero}`,
    ...lineasTexto,
    ...(transferencia ? bloqueTransferenciaTexto(transferencia, d.total) : []),
    ...(reintento ? ["", `Reintentar el pago: ${reintento}`] : []),
    ...(d.pedidosUrl ? ["", `Ver mis pedidos: ${d.pedidosUrl}`] : []),
    "",
    ...pieTexto(d.comercio, d.sitioUrl),
  ].join("\n");

  return { subject, html, text };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A quién va el aviso de pedido nuevo: el email de la sucursal del pedido; si falta (o no es un
 * email), el `receipts_email` de la empresa; si tampoco, null (no se manda nada).
 */
export function destinoAvisoOperador(
  emailSucursal: string | null | undefined,
  emailEmpresa: string | null | undefined,
): string | null {
  for (const c of [emailSucursal, emailEmpresa]) {
    const limpio = c?.trim();
    if (limpio && EMAIL_RE.test(limpio)) return limpio;
  }
  return null;
}

export interface DatosMailPedidoOperador {
  /** "PED-00000042". */
  numero: string;
  comercio: string;
  /** Nombre de la sucursal del pedido; ausente si no se pudo leer. */
  sucursal?: string | null;
  contactoNombre: string;
  contactoTelefono: string;
  clienteEmail?: string | null;
  lineas: LineaMail[];
  total: number;
  entrega?: string;
  pago?: string;
  /** Link absoluto al pedido en el administrador (`CRM_ADMIN_URL`). Sin él, el mail va sin botón. */
  pedidoUrl?: string | null;
  logoUrl?: string | null;
  sitioUrl?: string | null;
  /**
   * El comprador le cambió el medio a un pedido que el local ya conocía (por ejemplo, de
   * transferencia a Mercado Pago): nombre del medio anterior. El mail pasa a ser "Cambió el medio
   * de pago" y `pago` es el medio nuevo.
   */
  medioAnterior?: string;
}

/** Mail al local: "Nuevo pedido". Puro; todo dato del comprador pasa por `escapeHtml`. */
export function armarMailPedidoOperador(d: DatosMailPedidoOperador): MailPedido {
  const cambio = d.medioAnterior?.trim();
  const titulo = cambio ? "Cambió el medio de pago" : "Nuevo pedido";
  const subject = `${oneLine(d.comercio)} — ${cambio ? `Pedido ${d.numero}: cambió el medio de pago` : `Nuevo pedido ${d.numero}`}`.slice(0, 200);
  const bajada = cambio
    ? `La persona compradora cambió el medio de pago de ${cambio} a ${d.pago ?? "otro medio"}. Ya no espere el pago anterior.`
    : "Se registró un pedido nuevo en la tienda. Revíselo y coordine con la persona compradora.";
  const comprador: [string, string | undefined][] = [
    ["Nombre", d.contactoNombre.trim() || undefined],
    ["Teléfono", d.contactoTelefono.trim() || undefined],
    ["Email", d.clienteEmail?.trim() || undefined],
  ];
  const pedido: [string, string | undefined][] = [
    ["Sucursal", d.sucursal?.trim() || undefined],
    ["Total", moneda(d.total)],
    ["Entrega", d.entrega],
    ["Pago", d.pago],
  ];
  const filasDe = (datos: [string, string | undefined][]) =>
    datos
      .filter((f): f is [string, string] => Boolean(f[1]))
      .map(
        ([k, v]) => `
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#77808a;width:90px">${e(k)}</td>
            <td style="padding:4px 0;font-size:14px;color:#1c2733">${e(v)}</td>
          </tr>`,
      )
      .join("");
  const lineasHtml = d.lineas
    .map(
      (l) => `
          <tr>
            <td style="padding:4px 0;font-size:14px;color:#1c2733">${e(l.nombre)}</td>
            <td align="right" style="padding:4px 0 4px 12px;font-size:14px;color:#77808a;white-space:nowrap">× ${e(cantidad(l.cantidad))}</td>
          </tr>`,
    )
    .join("");
  const tabla = (filas: string, extra = "") =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FUENTE_MAIL};${extra}">${filas}
        </table>`;

  const cuerpoHtml = `
      <tr><td style="padding:20px 32px 0;font-family:${FUENTE_MAIL};color:#1c2733">
        <p style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:700">${e(titulo)}</p>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#77808a">${e(bajada)}</p>
        <p style="margin:12px 0 0;font-size:14px;color:#77808a">Pedido <strong style="color:#1c2733">${e(d.numero)}</strong></p>
      </td></tr>
      <tr><td style="padding:16px 32px 0">
        ${tabla(filasDe(comprador), "border-bottom:1px solid #eceae4;padding-bottom:8px")}
        ${tabla(lineasHtml, "border-bottom:1px solid #eceae4;padding:8px 0;margin-top:8px")}
        ${tabla(filasDe(pedido), "margin-top:8px")}
      </td></tr>
      <tr><td style="padding:24px 32px 28px;font-family:${FUENTE_MAIL}">
        ${
          d.pedidoUrl
            ? `<a href="${e(d.pedidoUrl)}" style="display:inline-block;background:#1e5aa8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Ver el pedido</a>`
            : ""
        }
      </td></tr>`;

  const html = tarjetaMail({
    preheader: `${titulo} · ${d.numero} · ${moneda(d.total)}`,
    logoUrl: d.logoUrl,
    nombreComercio: d.comercio,
    cuerpoHtml,
    sitioUrl: d.sitioUrl,
  });

  const text = [
    titulo,
    "",
    bajada,
    "",
    `Pedido ${d.numero}`,
    ...comprador.filter((f) => f[1]).map(([k, v]) => `${k}: ${v}`),
    "",
    ...d.lineas.map((l) => `- ${l.nombre} × ${cantidad(l.cantidad)}`),
    "",
    ...pedido.filter((f) => f[1]).map(([k, v]) => `${k}: ${v}`),
    ...(d.pedidoUrl ? ["", `Ver el pedido: ${d.pedidoUrl}`] : []),
    "",
    ...pieTexto(d.comercio, d.sitioUrl),
  ].join("\n");

  return { subject, html, text };
}
