/**
 * Precios de una lista PRIVADA (change `listas-cuenta-corriente`). SOLO servidor.
 *
 * Única lectura de `public.catalog_products_shop_privados`. El id de la lista NUNCA viene del
 * navegador: lo decide `listaPrivadaDelComprador()` a partir de la sesión. Estas funciones no se
 * llaman jamás desde una función con `use cache` ni desde una página estática: el precio privado
 * es por usuario y una caché compartida lo filtraría al resto.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCatalogo, crmPreciosPrivados } from "@/db/crm";
import { enTenantCatalogo } from "./catalogo-fuente";
import { precioPrivado, type PrecioCuenta } from "./precio-cuenta";
import { shopTenantId } from "./tenant";

/**
 * Precio NETO (sin IVA) de cada id en la lista privada `listaId`. Un id sin precio en esa lista
 * (la vista no tiene renglón, o el precio es 0) vale `null` ("Consulte"): nunca se cae al precio
 * público ni se devuelve 0.
 */
export async function preciosPrivados(
  listaId: string,
  alegraIds: readonly string[],
): Promise<Map<string, number | null>> {
  const salida = new Map<string, number | null>(alegraIds.map((id) => [id, null]));
  if (alegraIds.length === 0) return salida;
  const filas = await getDb()
    .select({ alegraId: crmPreciosPrivados.alegraId, precio: crmPreciosPrivados.precio })
    .from(crmPreciosPrivados)
    .where(
      and(
        eq(crmPreciosPrivados.tenantId, shopTenantId()),
        eq(crmPreciosPrivados.listaId, listaId),
        inArray(crmPreciosPrivados.alegraId, [...alegraIds]),
      ),
    );
  for (const f of filas) {
    const n = Number(f.precio);
    salida.set(f.alegraId, Number.isFinite(n) && n > 0 ? n : null);
  }
  return salida;
}

/**
 * Para el overlay `/api/precios-cuenta`: el precio de cada id en la lista privada, con el final con
 * IVA (el IVA sale de la vista pública del catálogo). `null` = "Consulte". Un id que el catálogo no
 * tiene queda `null`.
 */
export async function preciosCuentaPorIds(
  listaId: string,
  alegraIds: readonly string[],
): Promise<Record<string, PrecioCuenta | null>> {
  if (alegraIds.length === 0) return {};
  const [privados, ivas] = await Promise.all([
    preciosPrivados(listaId, alegraIds),
    getDb()
      .select({ alegraId: crmCatalogo.alegraId, ivaPorcentaje: crmCatalogo.ivaPorcentaje })
      .from(crmCatalogo)
      .where(and(enTenantCatalogo(), inArray(crmCatalogo.alegraId, [...alegraIds]))),
  ]);
  const ivaDe = new Map(ivas.map((f) => [f.alegraId, f.ivaPorcentaje != null ? Number(f.ivaPorcentaje) : null]));
  return Object.fromEntries(
    alegraIds.map((id) => [id, precioPrivado(privados.get(id) ?? null, ivaDe.get(id) ?? null)]),
  );
}
