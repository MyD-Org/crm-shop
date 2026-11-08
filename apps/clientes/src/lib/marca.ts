/**
 * Marca de la tienda leída de la base. SOLO servidor. La parte pura (valores de partida, saneo,
 * `resolverMarca`) está en `marca-base.ts`, que también usan el proxy y los componentes cliente.
 *
 * `getMarca()` va en el shell estático (Cache Components): `'use cache'` con el tag `marca`, que el
 * CRM vence con el ping `/api/internal/marca/revalidar`. NUNCA lanza: si la base no responde, o la
 * columna `shop_marca` (migración 0085 del CRM) todavía no existe, cae a la marca de entorno
 * (`NEXT_PUBLIC_SHOP_MARCA_NOMBRE`; sin la variable, la de Central) con el perfil `degradado`, así
 * un fallback no se guarda por horas.
 *
 * Por sitio: la misma tienda puede servirse desde más de un dominio. Un sitio con marca propia
 * (`shop_destinos_extra[i].marca`, ver `sitio.ts`) usa ESA marca y nunca la de Central; un alias o
 * el principal usan `shop_marca`. La función cacheada recibe la clave del sitio como argumento, así
 * entra en la clave de caché. Si `shop_destinos_extra` no se puede leer (sin permiso todavía), se
 * degrada a la marca de entorno, nunca a la del principal.
 */
import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmTenants } from "@/db/crm";
import { TAG_MARCA } from "@/lib/cache-tags";
import { hostsDeMarca, marcaDeEntorno, resolverMarca, resolverMarcaPropia, type Marca } from "@/lib/marca-base";
import { claveSitio, resolverSitioPorClave } from "@/lib/sitio";
import { leerDestinosExtra } from "@/lib/sitio-datos";
import { shopTenantId } from "@/lib/tenant";

export * from "@/lib/marca-base";

export async function getMarca(): Promise<Marca> {
  return marcaDelSitio(claveSitio());
}

async function marcaDelSitio(sitio: string): Promise<Marca> {
  "use cache";
  cacheTag(TAG_MARCA);
  try {
    const [fila] = await getDb()
      .select({ shopMarca: crmTenants.shopMarca })
      .from(crmTenants)
      .where(eq(crmTenants.id, shopTenantId()))
      .limit(1);
    const envNombre = process.env.NEXT_PUBLIC_SHOP_MARCA_NOMBRE;
    const hosts = hostsDeMarca();
    // Sin sitio en el entorno ni override: es el principal, no hace falta leer los extras.
    const propio = sitio === "|" ? null : resolverSitioPorClave(sitio, await leerDestinosExtra());
    const marca = propio?.propio
      ? resolverMarcaPropia(propio.marca, envNombre, hosts)
      : resolverMarca(fila?.shopMarca, envNombre, hosts);
    cacheLife("marca");
    return marca;
  } catch (err) {
    console.error(`[marca] no se pudo leer la marca, uso la de entorno: ${err instanceof Error ? err.message : "desconocido"}`);
    cacheLife("degradado");
    return marcaDeEntorno();
  }
}
