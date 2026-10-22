/**
 * Bloque de contacto de un pedido "a confirmar" (rebanada C), lógica PURA: plazo prometido, mensaje
 * (por defecto o el que carga el operador con `{plazo}` y `{whatsapp}`) y enlace a WhatsApp de la
 * sucursal asignada. Lo usan la pantalla de confirmación, el mail y el detalle en Mi cuenta.
 *
 * El número de WhatsApp sale de la base (`public.sucursales.whatsapp`); acá nunca hay números reales.
 */

export interface ContactoPedidoVista {
  /** Texto ya resuelto (plazo, y `{plazo}`/`{whatsapp}` reemplazados si hay mensaje propio). */
  mensaje: string;
  /** Plazo en horas hábiles tal como está en las reglas; 0 = sin plazo numérico. */
  horasHabiles: number;
  /** null = el pedido no tiene sucursal, o la sucursal no tiene número cargado. */
  whatsapp: { visible: string; url: string } | null;
}

/**
 * Los dígitos que van después de `wa.me/`, en formato internacional de celular argentino (549 +
 * característica + número). WhatsApp exige ese formato y en el admin se cargan como se dictan
 * ("0376 455-0100", "223 555-0100", "011 15 5555-0100"), así que por las dudas:
 * - con 549 adelante, queda igual;
 * - con 54 sin el 9 (12 dígitos), se agrega el 9;
 * - número nacional: sin el 0 de la característica y sin el 15; si quedan 10 dígitos, 549 adelante.
 * Cualquier otra forma (número de otro país, incompleto) se deja como vino.
 */
export function digitosWhatsapp(numero: string | null | undefined): string {
  const d = (numero ?? "").replace(/\D/g, "");
  if (d.startsWith("549")) return d;
  if (d.startsWith("54") && d.length === 12) return `549${d.slice(2)}`;
  let nacional = d.replace(/^0/, "");
  if (nacional.length === 12) {
    // El 15 va después de la característica (2 a 4 dígitos).
    const area = [2, 3, 4].find((n) => nacional.slice(n, n + 2) === "15");
    if (area) nacional = nacional.slice(0, area) + nacional.slice(area + 2);
  }
  return nacional.length === 10 ? `549${nacional}` : d;
}

/** Mensaje precargado del WhatsApp de un local desde la ficha: qué producto se consulta. */
export function textoConsultaProducto(nombre: string, codigo?: string | null): string {
  const cod = codigo?.trim();
  return `Hola, quisiera consultar por el producto ${nombre.trim()}${cod ? ` (código ${cod})` : ""}.`;
}

/**
 * `https://wa.me/<dígitos>` (con `?text=` si se pasa un texto precargado), o null si el número no
 * tiene pinta de teléfono (menos de 8 o más de 15 dígitos, el máximo de E.164).
 */
export function enlaceWhatsapp(
  numero: string | null | undefined,
  textoPrecargado?: string,
): string | null {
  const d = digitosWhatsapp(numero);
  if (d.length < 8 || d.length > 15) return null;
  const base = `https://wa.me/${d}`;
  const texto = textoPrecargado?.trim();
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

/** "24 horas hábiles", "1 hora hábil" o "a la brevedad" (0 o menos). */
export function plazoTexto(horasHabiles: number): string {
  if (!Number.isFinite(horasHabiles) || horasHabiles <= 0) return "a la brevedad";
  const h = Math.round(horasHabiles);
  return h === 1 ? "1 hora hábil" : `${h} horas hábiles`;
}

/** Lo que se dice cuando el operador no cargó un mensaje propio. */
export function mensajePorDefecto(horasHabiles: number): string {
  if (!Number.isFinite(horasHabiles) || horasHabiles <= 0)
    return "Nos comunicaremos a la brevedad.";
  const h = Math.round(horasHabiles);
  return h === 1
    ? "Nos comunicaremos dentro de 1 hora hábil."
    : `Nos comunicaremos dentro de las ${h} horas hábiles.`;
}

export interface EntradaContacto {
  horasHabiles: number;
  /** `sucursales.whatsapp` de la sucursal asignada; null = el pedido no tiene sucursal. */
  whatsapp: string | null | undefined;
  /** `reglas_venta.mensaje_confirmacion`; vacío o null = el texto por defecto. */
  mensajeConfirmacion?: string | null;
  /** "PED-00000042": va en el texto precargado del chat. */
  numeroPedido?: string;
}

export function armarContactoPedido(e: EntradaContacto): ContactoPedidoVista {
  const visible = (e.whatsapp ?? "").trim();
  const texto = e.numeroPedido ? `Hola, le escribo por mi pedido ${e.numeroPedido}.` : undefined;
  const url = visible ? enlaceWhatsapp(visible, texto) : null;
  const whatsapp = url ? { visible, url } : null;

  const propio = e.mensajeConfirmacion?.trim();
  const mensaje = propio
    ? propio
        .replaceAll("{plazo}", plazoTexto(e.horasHabiles))
        .replaceAll("{whatsapp}", "WhatsApp")
        // Sin número, espacios no quedan dobles con "WhatsApp".
        .trim()
    : mensajePorDefecto(e.horasHabiles);
  return { mensaje, horasHabiles: e.horasHabiles, whatsapp };
}
