/**
 * Lista de precios PRIVADA del comprador (change `listas-cuenta-corriente`). Pura: sin DB, sin
 * Next. La parte con DB y sesión vive en `lista-cuenta-repo.ts`.
 *
 * Regla: el comprador ve la lista privada si y sólo si es cuenta corriente (según el espejo del
 * CRM), su contacto de Alegra tiene una lista asignada y el admin la enlazó a una lista online
 * privada. La clave del enlace es (tenant, cuenta de Alegra, id de la lista de Alegra). En
 * cualquier otro caso —anónimo, sin vincular, contado, sin lista, sin enlace— rige el precio
 * público. El resultado se decide siempre en el servidor y nunca viaja desde el navegador.
 */

export interface ContactoParaLista {
  tipoCuenta: "corriente" | "contado";
  /** Id de la lista de precios asignada al contacto en Alegra. */
  priceListId: string | null;
}

/** (cuenta de Alegra, id de lista de Alegra) → id de la lista online privada, o null. */
export type BuscarMapeo = (alegraAccount: string, alegraPriceListId: string) => Promise<string | null>;

export async function resolverListaCuenta(
  contacto: ContactoParaLista | null,
  alegraAccount: string,
  buscarMapeo: BuscarMapeo,
): Promise<string | null> {
  if (!contacto || contacto.tipoCuenta !== "corriente" || !contacto.priceListId) return null;
  return buscarMapeo(alegraAccount, contacto.priceListId);
}
