/**
 * Textos de "sus precios de cliente" (lista online privada de la cuenta). Registro neutro (decisión de la usuaria, 2026-11-23): frases impersonales, sin usted ni vos.
 * A propósito no dicen "cuenta corriente" en ningún lado.
 */
export const TEXTOS_PRECIOS_CLIENTE = {
  /** Aviso fijo de la tienda: título; el nombre del cliente va aparte (`nombreDelCliente`). */
  aviso: "Precios de cliente aplicados",
  /** Etiqueta chica bajo el precio en cards y ficha. */
  etiqueta: "Precio de cliente",
  /** Rótulo del precio tachado (ficha; en la card es sólo accesible). */
  precioGeneral: "Precio general",
  /** Ahorro respecto del general tachado. */
  ahorro: (pct: number) => `${pct}% menos`,
  /** Checkout, paso Pago, bajo el medio "Efectivo o cheque". */
  checkoutPago:
    "Pedido con precios de cliente. Queda a confirmar, sin cobro en la tienda.",
} as const;

/** Siglas societarias que quedan en mayúsculas. */
const SIGLAS = new Set(["SA", "SRL", "SAS", "SH", "SAIC", "SACIF", "SCA", "SC", "SE", "UTE", "SAU", "SRLU"]);
/** Palabras menores que van en minúscula salvo al principio. */
const MENORES = new Set(["de", "del", "la", "las", "los", "y", "e", "el"]);

/**
 * Razón social para mostrar. Si viene toda en mayúsculas (como suele estar en Alegra), la pasa a
 * tipo título y deja las siglas societarias en mayúsculas; si ya tiene minúsculas, la respeta.
 * Vacía o ausente = `null`.
 */
export function nombreDelCliente(razonSocial?: string | null): string | null {
  const limpio = razonSocial?.trim().replace(/\s+/g, " ");
  if (!limpio) return null;
  if (limpio !== limpio.toLocaleUpperCase("es-AR")) return limpio;
  return limpio
    .split(" ")
    .map((palabra, i) => {
      const base = palabra.replace(/\./g, "");
      if (SIGLAS.has(base) || /\d/.test(palabra)) return palabra;
      const minus = palabra.toLocaleLowerCase("es-AR");
      if (i > 0 && MENORES.has(minus)) return minus;
      return minus.charAt(0).toLocaleUpperCase("es-AR") + minus.slice(1);
    })
    .join(" ");
}
