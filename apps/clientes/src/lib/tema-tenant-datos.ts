/**
 * Tema de la tienda leído de la base. SOLO servidor. La parte pura (saneo, CSS) está en
 * `tema-tenant.ts`.
 *
 * `getTemaTenant()` va en el shell estático (Cache Components), con el mismo tag `marca` que la
 * marca: el ping del CRM (`/api/internal/marca/revalidar`) vence las dos. NUNCA lanza: si la base
 * no responde, o la columna `shop_tema` (migración 0086 del CRM) todavía no existe, devuelve el
 * tema de Central (sin paleta propia) con el perfil `degradado`, así un fallback no se guarda por
 * horas.
 *
 * Por sitio (ver `sitio.ts`): un sitio con marca propia usa el `tema` de su destino (sin tema =
 * sin paleta propia); un alias o el principal usan `shop_tema`. La clave del sitio viaja como
 * argumento de la función cacheada.
 */
import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmTenants } from "@/db/crm";
import { TAG_MARCA } from "@/lib/cache-tags";
import { claveSitio, resolverSitioPorClave } from "@/lib/sitio";
import { leerDestinosExtra } from "@/lib/sitio-datos";
import { sanearTemaTenant, type TemaTenant } from "@/lib/tema-tenant";
import { shopTenantId } from "@/lib/tenant";

export async function getTemaTenant(): Promise<TemaTenant> {
  return temaDelSitio(claveSitio());
}

async function temaDelSitio(sitio: string): Promise<TemaTenant> {
  "use cache";
  cacheTag(TAG_MARCA);
  try {
    const [fila] = await getDb()
      .select({ shopTema: crmTenants.shopTema })
      .from(crmTenants)
      .where(eq(crmTenants.id, shopTenantId()))
      .limit(1);
    const propio = sitio === "|" ? null : resolverSitioPorClave(sitio, await leerDestinosExtra());
    const tema = sanearTemaTenant(propio?.propio ? propio.tema : fila?.shopTema);
    cacheLife("marca");
    return tema;
  } catch (err) {
    console.error(`[tema] no se pudo leer el tema, uso el de Central: ${err instanceof Error ? err.message : "desconocido"}`);
    cacheLife("degradado");
    return sanearTemaTenant(null);
  }
}
