/**
 * Lista privada del comprador, con DB y sesión (change `listas-cuenta-corriente`). SOLO servidor.
 * La regla pura está en `lista-cuenta.ts`.
 *
 * Una cuenta corriente con lista de Alegra enlazada a una lista online privada ve y paga ESA
 * lista. La clave del contacto es (tenant, cuenta de Alegra, id): el Shop lee la cuenta de Alegra
 * del despliegue (`shopCuentaAlegra()`), y el enlace de listas se busca en esa misma cuenta.
 *
 * Nunca desde `use cache`: depende de quién pide.
 */
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmListaMapeo } from "@/db/crm";
import { identidadActual } from "./auth";
import { vinculablePorId } from "./contactos-espejo";
import { shopCuentaAlegra } from "./cuenta-alegra";
import { resolverListaCuenta } from "./lista-cuenta";
import { shopTenantId } from "./tenant";

/** Lista online privada enlazada a una lista de Alegra de esa cuenta, o `null` si no hay enlace. */
export async function listaMapeada(alegraAccount: string, alegraPriceListId: string): Promise<string | null> {
  const [fila] = await getDb()
    .select({ listaId: crmListaMapeo.listaId })
    .from(crmListaMapeo)
    .where(
      and(
        eq(crmListaMapeo.tenantId, shopTenantId()),
        eq(crmListaMapeo.alegraAccount, alegraAccount),
        eq(crmListaMapeo.alegraPriceListId, alegraPriceListId),
      ),
    )
    .limit(1);
  return fila?.listaId ?? null;
}

/**
 * Lista privada de un contacto de Alegra (su `codigocliente`), leyendo el espejo del CRM: 0
 * requests a Alegra. `null` = precio público (sin fila en el espejo, contado, sin lista o sin
 * enlace). Tira si la base no responde: quien llama decide (el overlay cae al precio público, la
 * cotización y el pedido fallan: sin datos no hay total).
 */
export async function listaPrivadaDeContacto(alegraId: string): Promise<string | null> {
  const contacto = await vinculablePorId(alegraId);
  return resolverListaCuenta(
    contacto ? { tipoCuenta: contacto.tipoCuenta, priceListId: contacto.priceList?.id ?? null } : null,
    shopCuentaAlegra(),
    listaMapeada,
  );
}

/**
 * Lista privada de quien hace el request. Sale SIEMPRE de la identidad de la sesión (nunca de la
 * URL ni del body): anónimo y logueado sin cuenta vinculada ⇒ `null`. Memoizada por request.
 */
export const listaPrivadaDelComprador = cache(async function listaPrivadaDelComprador(): Promise<string | null> {
  const { cliente } = await identidadActual();
  if (!cliente) return null;
  return listaPrivadaDeContacto(cliente.codigocliente);
});
