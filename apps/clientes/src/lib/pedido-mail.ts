/**
 * Mails al comprador sobre su pedido: "Recibimos su pedido" (al crearlo, sólo en medios sin cobro
 * en línea) y los del cobro en línea: "¡Gracias por su compra!" (al aprobarse, es el único
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
import { montoPorCuota } from "./cuotas-sin-interes";
import { TEXTOS_CUOTAS } from "./cuotas-textos";

export interface MailPedido {
  subject: string;
  html: string;
  text: string;
}

export type AvisoPedidoShop = "recibido" | "pago_recibido" | "pago_rechazado" | "pago_pendiente";

export interface LineaMail {
  nombre: string;
  cantidad: number;
  /** Línea a pedido (venta sin stock): el texto de su modalidad, del snapshot del pedido. */
  aPedido?: string;
}

/** La línea del cupón en los mails: texto armado (`textoLineaCupon`) y descuento con IVA. */
export interface CuponMail {
  texto: string;
  descuento: number;
}

/** [rótulo, valor] de la línea del cupón; nada sin cupón o sin descuento. */
const filaCupon = (c: CuponMail | null | undefined): [string, string][] =>
  c && c.descuento > 0 ? [[c.texto, `−${moneda(c.descuento)}`]] : [];

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
  /**
   * Compra como invitado: link firmado «Pagar su pedido» (`/pagar/<token>`). Sólo si el pedido sigue
   * pendiente de pago en línea. En "pago_rechazado" es el destino de «Reintentar el pago».
   */
  pagarUrl?: string | null;
  /** Compra como invitado: link «Cree su cuenta» (`/registro?email=`). Reemplaza a «Ver mis pedidos». */
  cuentaUrl?: string | null;
  /** "recibido", "pago_recibido" y "pago_pendiente": resumen del pedido. */
  lineas?: LineaMail[];
  total?: number;
  /** Envío por zona: lo que se cobró de envío (con IVA). Sólo si es mayor que 0; ausente = no se muestra. */
  costoEnvio?: number;
  /** Cupón del pedido: la misma línea que el checkout ("Cupón LUZ-7KQ2M (10 %)", −$X), antes del total. */
  cupon?: CuponMail | null;
  entrega?: string;
  pago?: string;
  /**
   * "pago_recibido": lo que cobró el procesador (cuotas y total pagado). En cuotas se agrega al medio
   * ("Mercado Pago, 12 cuotas de $X"); con interés, también el total pagado (informativo: el total del
   * pedido y la factura quedan al precio de 1 pago).
   */
  pagado?: { total: number; cuotas: number };
  /** Sólo "recibido": el pedido es de una cuenta corriente y `pago` es el nombre de su medio. */
  pagoCuentaCorriente?: boolean;
  /** Sólo "recibido": pedido a confirmar por modalidad (venta sin stock): no se cobró nada. */
  aConfirmar?: boolean;
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
        : d.aConfirmar
          ? "Registramos su pedido. Quedó a confirmar y no se realizó ningún cobro: nos comunicaremos con usted para confirmarlo. Le avisaremos por este medio cada vez que avance."
          : "Registramos su pedido. Le avisaremos por este medio cada vez que avance.",
  },
  pago_recibido: {
    asunto: "con pago aprobado",
    titulo: "¡Gracias por su compra!",
    bajada: () =>
      "Su pago fue aprobado y su pedido quedó registrado. Le avisaremos por este medio cada vez que avance.",
  },
  pago_rechazado: {
    asunto: "pago no procesado",
    titulo: "No pudimos procesar su pago",
    bajada: () =>
      "El pago de su pedido no se pudo completar y no se le cobró. Puede reintentar el pago o elegir otro medio de pago; su pedido sigue registrado.",
  },
  pago_pendiente: {
    asunto: "pendiente de pago",
    titulo: "Su pedido está pendiente de pago",
    bajada: () =>
      "Todavía no recibimos el pago de su pedido. Puede completarlo cuando quiera con el botón «Pagar su pedido»; mientras la reserva esté vigente, su pedido sigue registrado.",
  },
};

const ESTILO_BOTON =
  "display:inline-block;background:#1e5aa8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px";
const ESTILO_ENLACE = "display:inline-block;color:#1e5aa8;text-decoration:underline;font-size:14px;font-weight:600;padding:10px 12px";

/** Texto que acompaña a «Cree su cuenta» en el mail del invitado. */
export const TEXTO_CREE_SU_CUENTA =
  "Cree su cuenta con este mismo correo electrónico y encontrará sus pedidos en Mi cuenta.";

/**
 * El medio con lo que cobró el procesador: "Mercado Pago, 12 cuotas de $6.980,64" y, si pagó más que el
 * total del pedido (interés de las cuotas), "(total pagado $X)". En 1 pago, el medio solo.
 */
function textoPago(d: { pago?: string; total?: number; pagado?: { total: number; cuotas: number } }): string | undefined {
  const p = d.pagado;
  if (!d.pago || !p || p.cuotas < 2) return d.pago;
  const conInteres = d.total !== undefined && p.total > d.total + 0.01;
  return `${d.pago}, ${TEXTOS_CUOTAS.cuotasDe(p.cuotas, montoPorCuota(p.total, p.cuotas))}${
    conInteres ? ` (total pagado ${moneda(p.total)})` : ""
  }`;
}

/** Fila de una línea: el nombre y, si va a pedido, el texto de su modalidad en gris debajo. */
function filaLineaHtml(l: LineaMail): string {
  const aPedido = l.aPedido
    ? `<br><span style="font-size:13px;color:#77808a">${e(l.aPedido)}</span>`
    : "";
  return `
          <tr>
            <td style="padding:4px 0;font-size:14px;color:#1c2733">${e(l.nombre)}${aPedido}</td>
            <td align="right" style="padding:4px 0 4px 12px;font-size:14px;color:#77808a;white-space:nowrap">× ${e(cantidad(l.cantidad))}</td>
          </tr>`;
}

function lineaTexto(l: LineaMail): string {
  return `- ${l.nombre} × ${cantidad(l.cantidad)}${l.aPedido ? ` (${l.aPedido})` : ""}`;
}

function resumen(d: DatosMailPedido): string {
  const filas = (d.lineas ?? []).map(filaLineaHtml).join("");
  const datos: [string, string | undefined][] = [
    ...filaCupon(d.cupon),
    ["Envío", d.costoEnvio && d.costoEnvio > 0 ? moneda(d.costoEnvio) : undefined],
    ["Total", d.total !== undefined ? moneda(d.total) : undefined],
    ["Entrega", d.entrega],
    ["Pago", textoPago(d)],
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
  // Invitado: «Pagar su pedido» (en "pago_rechazado" lo cubre «Reintentar el pago») y «Cree su cuenta».
  const pagar = d.aviso !== "pago_rechazado" ? d.pagarUrl : undefined;
  const cuenta = d.cuentaUrl || undefined;

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
        }${pagar ? `<a href="${e(pagar)}" style="${ESTILO_BOTON}">Pagar su pedido</a>` : ""}${
          cuenta
            ? `${pagar || reintento ? " " : ""}<a href="${e(cuenta)}" style="${ESTILO_ENLACE}">Cree su cuenta</a>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.55;color:#77808a">${e(TEXTO_CREE_SU_CUENTA)}</p>`
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
        ...(d.lineas ?? []).map(lineaTexto),
        ...filaCupon(d.cupon).map(([k, v]) => `${k}: ${v}`),
        ...(d.costoEnvio && d.costoEnvio > 0 ? [`Envío: ${moneda(d.costoEnvio)}`] : []),
        ...(d.total !== undefined ? [`Total: ${moneda(d.total)}`] : []),
        ...(d.entrega ? [`Entrega: ${d.entrega}`] : []),
        ...(d.pago ? [`Pago: ${textoPago(d)}`] : []),
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
    ...(pagar ? ["", `Pagar su pedido: ${pagar}`] : []),
    ...(d.pedidosUrl ? ["", `Ver mis pedidos: ${d.pedidosUrl}`] : []),
    ...(cuenta ? ["", `Cree su cuenta: ${cuenta}`, TEXTO_CREE_SU_CUENTA] : []),
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
  cupon?: CuponMail | null;
  entrega?: string;
  /** Lo que cobró el procesador (ver `DatosMailPedido.pagado`). */
  pagado?: { total: number; cuotas: number };
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
    ...filaCupon(d.cupon),
    ["Total", moneda(d.total)],
    ["Entrega", d.entrega],
    ["Pago", textoPago(d)],
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
  const lineasHtml = d.lineas.map(filaLineaHtml).join("");
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
    ...d.lineas.map(lineaTexto),
    "",
    ...pedido.filter((f) => f[1]).map(([k, v]) => `${k}: ${v}`),
    ...(d.pedidoUrl ? ["", `Ver el pedido: ${d.pedidoUrl}`] : []),
    "",
    ...pieTexto(d.comercio, d.sitioUrl),
  ].join("\n");

  return { subject, html, text };
}
