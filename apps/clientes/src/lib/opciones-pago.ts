/**
 * Cards del paso Pago del checkout: una por forma de pagar, no una por medio. Lógica PURA.
 *
 * Mercado Pago se abre en hasta tres cards ("Mercado Pago" = dinero en cuenta, "Tarjeta de crédito",
 * "Tarjeta de débito"), cada una con su total; así el comprador elige la forma antes de confirmar y el
 * formulario de pago abre directo en ella. Payway sólo aporta las tarjetas que Mercado Pago no ofrece
 * (si los dos están activos, las tarjetas se cobran con Mercado Pago). El resto de los medios
 * (transferencia, efectivo…) es una card cada uno, sin forma.
 */
import { SLUG_TRANSFERENCIA } from "./cuentas-bancarias";
import { listaDelPagoUnico } from "./lista-medio";
import { procesadorDeMedio, type MedioPago } from "./medios-pago";
import { opcionesAplicables, type OpcionCobro } from "./pagos/opciones-cobro";

export interface OpcionPago {
  /** Identifica la card: `slug` o `slug:forma`. */
  clave: string;
  slug: string;
  /** Forma de pago de la card; `null` = medio sin formas (transferencia, efectivo…). */
  forma: OpcionCobro | null;
}

/** Orden de las cards de un medio de cobro en línea. */
const ORDEN_FORMAS: readonly OpcionCobro[] = ["cuenta_mp", "credito", "debito"];

export function claveOpcion(slug: string, forma: OpcionCobro | null): string {
  return forma ? `${slug}:${forma}` : slug;
}

/** Cards a mostrar, en el orden de los medios (que ya vienen filtrados por modalidad y ordenados). */
export function opcionesDePago(medios: readonly Pick<MedioPago, "slug" | "opcionesCobro">[]): OpcionPago[] {
  // Formas que ya cubre Mercado Pago: Payway no las repite.
  const cubiertas = new Set<OpcionCobro>();
  for (const m of medios) {
    if (procesadorDeMedio(m.slug) === "mercadopago") opcionesAplicables("mercadopago", m.opcionesCobro).forEach((f) => cubiertas.add(f));
  }
  return medios.flatMap((m): OpcionPago[] => {
    const procesador = procesadorDeMedio(m.slug);
    if (!procesador) return [{ clave: claveOpcion(m.slug, null), slug: m.slug, forma: null }];
    const formas = opcionesAplicables(procesador, m.opcionesCobro);
    return ORDEN_FORMAS.filter((f) => formas.includes(f) && (procesador === "mercadopago" || !cubiertas.has(f))).map((f) => ({
      clave: claveOpcion(m.slug, f),
      slug: m.slug,
      forma: f,
    }));
  });
}

/** La card elegida si sigue disponible; si no, la primera (o null). */
export function opcionElegida(opciones: readonly OpcionPago[], clave: string): OpcionPago | null {
  return opciones.find((o) => o.clave === clave) ?? opciones[0] ?? null;
}

/**
 * Lista de precios con la que se cotiza cada card ('' = la general). Las cards con la misma lista
 * comparten una sola cotización.
 */
export function listaDeOpcion(
  medios: readonly Pick<MedioPago, "slug" | "idListaPrecios" | "listasPorForma">[],
  opcion: OpcionPago,
): string {
  const medio = medios.find((m) => m.slug === opcion.slug);
  return (medio ? listaDelPagoUnico(medio, opcion.forma) : undefined) ?? "";
}

/** Título de la card. */
export function tituloOpcion(opcion: OpcionPago, nombreMedio: string): string {
  if (opcion.forma === "cuenta_mp") return "Mercado Pago";
  if (opcion.forma === "credito") return "Tarjeta de crédito";
  if (opcion.forma === "debito") return "Tarjeta de débito";
  return nombreMedio;
}

/** Título dentro de una frase ("Total con transferencia", "frente a tarjeta de crédito"): Mercado Pago queda igual. */
export function tituloEnFrase(opcion: OpcionPago, nombreMedio: string): string {
  const t = tituloOpcion(opcion, nombreMedio);
  return opcion.forma === "cuenta_mp" ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

/** Bajada de la card (los medios manuales que no son transferencia no llevan). */
export function bajadaOpcion(opcion: OpcionPago): string | undefined {
  if (opcion.forma === "cuenta_mp") return "Con dinero disponible en su cuenta";
  if (opcion.slug === SLUG_TRANSFERENCIA) return "Le enviamos los datos de la cuenta al confirmar";
  return undefined;
}

/** Detalle de la transferencia elegida cuando el admin no cargó instrucciones. */
export const DETALLE_TRANSFERENCIA = "Al confirmar le mostramos el CBU y el alias. Tiene 24 h para transferir y adjuntar el comprobante.";

/** Pie bajo el botón con la card de la cuenta de Mercado Pago elegida. */
export const PIE_CUENTA_MP = "Al confirmar, lo llevamos a Mercado Pago para completar el pago.";

/** Texto del botón de confirmar según la card elegida. */
export function textoConfirmar(opcion: OpcionPago | null): string {
  if (opcion?.forma === "cuenta_mp") return "Ir a Mercado Pago";
  if (opcion?.forma === "credito") return "Continuar con crédito";
  if (opcion?.forma === "debito") return "Continuar con débito";
  return "Confirmar pedido";
}

/**
 * Ahorro de una card frente a la más cara de las otras: lo que deja de pagar eligiéndola. `null` si
 * no ahorra o falta algún total.
 */
export function ahorroFrente(
  totales: Readonly<Record<string, number | null | undefined>>,
  opciones: readonly OpcionPago[],
  clave: string,
): { monto: number; frente: OpcionPago } | null {
  const propio = totales[clave];
  if (typeof propio !== "number") return null;
  let frente: OpcionPago | null = null;
  let max = -Infinity;
  for (const o of opciones) {
    const t = totales[o.clave];
    if (o.clave === clave || typeof t !== "number") continue;
    if (t > max) {
      max = t;
      frente = o;
    }
  }
  // Menos de un peso no es ahorro: diferencias de redondeo entre listas.
  return frente && max - propio >= 1 ? { monto: Math.round((max - propio) * 100) / 100, frente } : null;
}
