/**
 * Avisos de vencimiento: forma, textos y destino de cada aviso. Módulo PURO
 * (sin base, sin `next/*`): lo usan el servidor y la lista del cliente.
 *
 * Textos portados de `describeNotif` en apps/admin/src/components/portal/
 * PortalHeader.tsx, en usted. Destinos: nunca el portal del CRM (AVI-2).
 */
import { RUTAS_MI_CUENTA } from "../mi-cuenta-nav";

/**
 * Un aviso tal como lo ve el cliente. El CRM escribe una fila por canal (mail y
 * WhatsApp) del mismo `(factura, tipo)`: acá es UN aviso con todos sus `ids`.
 */
export interface Aviso {
  /** Id de la fila más reciente (clave de la lista). */
  id: string;
  /** Todas las filas del aviso (una por canal): se marcan juntas. */
  ids: string[];
  /** Número legible de la factura (el que ve el cliente). */
  facturaId: string;
  /** Id de Alegra; `null` en avisos anteriores a la migración 0022 del CRM. */
  facturaAlegraId: string | null;
  type: string;
  /** ISO 8601 del envío más reciente. */
  sentAt: string;
  /** "dd/mm/aaaa" en hora de Argentina, ya formateada en el servidor (sin desfasaje de hidratación). */
  fecha: string;
  /** Leído sólo si TODAS sus filas lo están. */
  leido: boolean;
}

export type TonoAviso = "info" | "warning" | "danger";

export interface DescripcionAviso {
  titulo: string;
  detalle: string;
  tono: TonoAviso;
  /** Etiqueta corta del Badge. */
  etiqueta: string;
  /** Sin destino: el aviso sólo se marca como leído. */
  destino: { href: string; label: string } | null;
}

/** Deep link de la factura del aviso (FAC-5): con el id de Alegra si lo hay. */
export function hrefFacturaAviso(numero: string, alegraId: string | null): string {
  const alegra = alegraId ? `&alegra=${encodeURIComponent(alegraId)}` : "";
  return `${RUTAS_MI_CUENTA.facturas}?factura=${encodeURIComponent(numero)}${alegra}`;
}

/**
 * Título, detalle, tono y destino de un aviso. `conditions_changed` lleva a
 * Condiciones sólo si el cliente es cuenta corriente (la única que la ve); si
 * no, a Facturas y saldo, que todo vinculado tiene.
 */
export function describirAviso(aviso: Pick<Aviso, "type" | "facturaId" | "facturaAlegraId">, esCuentaCorriente: boolean): DescripcionAviso {
  const verFactura = { href: hrefFacturaAviso(aviso.facturaId, aviso.facturaAlegraId), label: "Ver factura" };

  const antes = /^before_due_(\d+)$/.exec(aviso.type);
  if (antes) {
    const n = Number(antes[1]);
    const cuando = n === 0 ? "vence hoy" : n === 1 ? "vence mañana" : `vence en ${n} días`;
    return {
      titulo: `Su factura ${aviso.facturaId} ${cuando}`,
      detalle: "Recordatorio de vencimiento.",
      tono: n <= 1 ? "warning" : "info",
      etiqueta: "Por vencer",
      destino: verFactura,
    };
  }

  const despues = /^after_due_(\d+)$/.exec(aviso.type);
  if (despues) {
    const n = Number(despues[1]);
    return {
      titulo: `Su factura ${aviso.facturaId} venció hace ${n} ${n === 1 ? "día" : "días"}`,
      detalle: "Pago vencido. Regularice su cuenta.",
      tono: "danger",
      etiqueta: "Vencida",
      destino: verFactura,
    };
  }

  if (aviso.type === "conditions_changed") {
    return {
      titulo: "Se actualizaron sus condiciones comerciales",
      detalle: "Revise su condición de pago, sus descuentos y su crédito.",
      tono: "info",
      etiqueta: "Condiciones",
      destino: esCuentaCorriente
        ? { href: RUTAS_MI_CUENTA.condiciones, label: "Ver condiciones" }
        : { href: RUTAS_MI_CUENTA.facturas, label: "Ver facturas y saldo" },
    };
  }

  // Tipo que el Shop no conoce todavía (el listado ya los filtra): sin destino.
  return { titulo: `Aviso sobre su factura ${aviso.facturaId}`, detalle: "Aviso del sistema.", tono: "info", etiqueta: "Aviso", destino: null };
}

/** "Tiene 1 aviso sin leer." / "Tiene 3 avisos sin leer." */
export function textoNoLeidos(n: number): string {
  return n === 1 ? "Tiene 1 aviso sin leer." : `Tiene ${n} avisos sin leer.`;
}
