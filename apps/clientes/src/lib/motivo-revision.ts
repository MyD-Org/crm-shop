/**
 * Por qué un pedido queda para revisión de un operador antes de facturar
 * (`shop.orders.motivo_revision`, migración 0010). Lógica PURA: la ruta de
 * pedidos junta los datos y esto decide.
 *
 * Se guarda UN motivo, el más importante, y no una lista: el operador tiene que
 * resolver primero lo que impide facturar (el documento o la condición de IVA
 * de Alegra), y los motivos casi nunca coinciden (los del contacto y el del
 * checkout son de compradores vinculados; el de la lista, de no vinculados). Un
 * texto simple se filtra, se lista y se muestra sin más vueltas.
 *
 * Sin CHECK en la base, a propósito: sumar un motivo no tiene que pedir una
 * migración. El CRM muestra el texto genérico de siempre para un valor que no
 * conoce.
 */
import type { MotivoRevision } from "./contacto-alegra";

export type MotivoRevisionPedido =
  /** La condición de IVA de Alegra exige CUIT y el documento no lo es. */
  | "documento_incompatible"
  /** La condición de IVA de Alegra no es una de las que maneja la tienda. */
  | "condicion_iva_desconocida"
  /** Lo que el comprador cargó en el checkout no llegó a Alegra: está sólo en el pedido. */
  | "facturacion_en_pedido"
  /**
   * El documento es de un contacto de Alegra (que el comprador no vinculó) con
   * una lista de precios distinta de la general con la que compró.
   */
  | "otra_lista_precios";

/** De más a menos importante: el primero que aplica es el que se guarda. */
export const PRIORIDAD_MOTIVOS: readonly MotivoRevisionPedido[] = [
  "documento_incompatible",
  "condicion_iva_desconocida",
  "facturacion_en_pedido",
  "otra_lista_precios",
];

/**
 * ¿La lista del contacto es otra que la general? `idListaContacto` es la lista
 * USABLE del contacto (`idPriceListUsable`: sin lista o dada de baja ⇒
 * `undefined` = la general). `idListaGeneral` = la lista principal del catálogo;
 * `null` si no se pudo saber: entonces una lista asignada cuenta como distinta
 * (mejor que un operador mire de más a que se pierda el aviso).
 */
export function listaDistintaDeLaGeneral(
  idListaContacto: string | null | undefined,
  idListaGeneral: string | null,
): boolean {
  if (!idListaContacto) return false;
  if (idListaGeneral === null) return true;
  return idListaContacto !== idListaGeneral;
}

export interface EntradaMotivo {
  /** Motivo que salió de leer el contacto de Alegra (sólo vinculados). */
  motivoContacto: MotivoRevision | null;
  /** Se facturó con lo cargado en el checkout porque no se pudo escribir en Alegra. */
  complementoUsado: boolean;
  /** El pedido se cotizó a la lista del cliente (vinculado): la regla de la lista no aplica. */
  vinculado: boolean;
  /** Contacto de Alegra con el mismo documento (no vinculado), o `null` si no hay. */
  listaContacto: { id: string | null | undefined } | null;
  /** Lista general del catálogo, `null` si no se pudo saber. */
  idListaGeneral: string | null;
}

/** El motivo más importante que aplica, o `null` = el pedido no necesita revisión. */
export function motivoRevisionPedido(e: EntradaMotivo): MotivoRevisionPedido | null {
  const aplican = new Set<MotivoRevisionPedido>();
  if (e.motivoContacto) aplican.add(e.motivoContacto);
  if (e.complementoUsado) aplican.add("facturacion_en_pedido");
  if (!e.vinculado && e.listaContacto && listaDistintaDeLaGeneral(e.listaContacto.id, e.idListaGeneral)) {
    aplican.add("otra_lista_precios");
  }
  return PRIORIDAD_MOTIVOS.find((m) => aplican.has(m)) ?? null;
}
