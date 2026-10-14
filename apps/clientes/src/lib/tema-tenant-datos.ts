/**
 * Tema de la tienda leído de la base. SOLO servidor. La parte pura (saneo, CSS) está en
 * `tema-tenant.ts`.
 *
 * `getTemaTenant()` va en el shell estático (Cache Components), con el mismo tag `marca` que la
 * marca: el ping del CRM (`/api/internal/marca/revalidar`) vence las dos. NUNCA lanza: si la base
 * no responde, o la columna `shop_tema` (migración 0086 del CRM) todavía no existe, devuelve el
 * tema de Central (sin paleta propia) con el perfil `degradado`, así un fallback no se guarda por
 * horas.
 */
import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmTenants } from "@/db/crm";
import { TAG_MARCA } from "@/lib/cache-tags";
import { sanearTemaTenant, type TemaTenant } from "@/lib/tema-tenant";
import { shopTenantId } from "@/lib/tenant";

export async function getTemaTenant(): Promise<TemaTenant> {
  "use cache";
  cacheTag(TAG_MARCA);
  try {
    const [fila] = await getDb()
      .select({ shopTema: crmTenants.shopTema })
      .from(crmTenants)
      .where(eq(crmTenants.id, shopTenantId()))
      .limit(1);
    const tema = sanearTemaTenant(fila?.shopTema);
    cacheLife("marca");
    return tema;
  } catch (err) {
    console.error(`[tema] no se pudo leer el tema, uso el de Central: ${err instanceof Error ? err.message : "desconocido"}`);
    cacheLife("degradado");
    return sanearTemaTenant(null);
  }
}
