import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, catalogProducts } from "@/db/schema"
import { getItemsLive, type AlegraProduct } from "./alegra"
import { mapItemSecundario } from "./alegra-pareo"
import { listasDeLaPrincipal } from "./catalogo-union-repo"
import { configParaCuenta } from "./sucursales-cuenta"
import type { TenantConfig } from "./tenants"

// Lectura EN VIVO de ítems del catálogo (change `sucursales-igz-mdp`, D.1.21). El id que circula
// por el bot y la tienda es el `alegra_id` de `catalog_products`, que en las filas solo-secundaria
// es SINTÉTICO (`<slug>:<id_en_cuenta>`) y no existe en Alegra: hay que resolver el id real
// (`alegra_id_cuenta`) y hablar con la cuenta de origen con SUS credenciales. Nunca se manda un id
// sintético a Alegra ni se usan las credenciales de otra cuenta.
//
// Cada ítem vuelve con el mismo id que se pidió (el del catálogo), y los de una cuenta secundaria
// con las listas de precio reasignadas a las de la principal (mismo criterio que la sync), para que
// el número en vivo signifique lo mismo que el del catálogo. Los que no se pueden leer (cuenta sin
// credenciales, ítem borrado) simplemente no vuelven, igual que `getItemsLive`.

export async function getItemsLiveDelCatalogo(base: TenantConfig, ids: string[]): Promise<AlegraProduct[]> {
  const pedidos = [...new Set(ids)].filter(Boolean)
  if (pedidos.length === 0) return []

  const db = getDb()
  const filas = await db
    .select({ alegraId: catalogProducts.alegraId, cuentaId: catalogProducts.cuentaId, alegraIdCuenta: catalogProducts.alegraIdCuenta })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, base.id), inArray(catalogProducts.alegraId, pedidos)))

  const deSecundaria = new Map<string, { sintetico: string; real: string }[]>()
  const deLaPrincipal: string[] = []
  const info = new Map(filas.map((f) => [f.alegraId, f]))
  for (const id of pedidos) {
    const f = info.get(id)
    if (f?.cuentaId) {
      const lista = deSecundaria.get(f.cuentaId) ?? []
      lista.push({ sintetico: id, real: f.alegraIdCuenta ?? id })
      deSecundaria.set(f.cuentaId, lista)
    } else {
      // Fila de la principal, o id que no está en el espejo (se comporta como hoy).
      deLaPrincipal.push(id)
    }
  }

  const resultado: AlegraProduct[] = []
  if (deLaPrincipal.length > 0) resultado.push(...(await getItemsLive(base, deLaPrincipal)))

  if (deSecundaria.size > 0) {
    const cuentas = await db
      .select()
      .from(alegraCuentas)
      .where(and(eq(alegraCuentas.tenantId, base.id), inArray(alegraCuentas.id, [...deSecundaria.keys()])))
    const listas = await listasDeLaPrincipal(base.id)
    for (const cuenta of cuentas) {
      let cfg: TenantConfig
      try {
        cfg = configParaCuenta(base, cuenta)
      } catch {
        console.warn(`[alegra-live] tenant=${base.id} cuenta=${cuenta.slug} sin credenciales: no se leen sus ítems en vivo`)
        continue
      }
      const pares = deSecundaria.get(cuenta.id) ?? []
      const vivos = await getItemsLive(cfg, pares.map((p) => p.real))
      const sinteticoDeReal = new Map(pares.map((p) => [p.real, p.sintetico]))
      for (const v of vivos) {
        const sintetico = sinteticoDeReal.get(v.alegraId)
        if (!sintetico) continue
        const m = mapItemSecundario(v, { id: cuenta.id, slug: cuenta.slug }, listas, [], [])
        resultado.push({ ...m.producto, alegraId: sintetico })
      }
    }
  }
  return resultado
}
