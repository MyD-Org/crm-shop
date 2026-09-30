import { sql } from "drizzle-orm"
import { getDb } from "@/db"

// ¿Existen ya en `shop.orders` las columnas que agrega una migración del SHOP que todavía puede no
// estar aplicada? (change `sucursales-igz-mdp`, rebanada B: 0024 del Shop con `factura_cruzada`,
// `contactado_*`.) El CRM escribe esas columnas con SQL puro guardado por esta comprobación, en
// vez de declararlas en `shop-schema.ts`: una columna declarada que no existe rompe TODO select de
// pedidos (42703), y el orden de despliegue de las dos apps no lo controla el CRM.
//
// TODO(sucursales-igz-mdp B): cuando la migración 0024 del Shop esté en main y aplicada en prod,
// declarar las columnas en `shop-schema.ts` (bloque comentado ahí), pasar estas escrituras a
// drizzle y borrar este módulo.
//
// Un `true` se recuerda para siempre (las migraciones no se revierten); un `false` se reintenta
// pasado el TTL, así el CRM lo nota solo después de que se aplique la migración del Shop.

const TTL_NEGATIVO_MS = 60_000

type Entrada = { ok: boolean; at: number }
const cache = new Map<string, Entrada>()

/** Solo para tests: olvida lo comprobado. */
export function reiniciarCacheColumnasShop(): void {
  cache.clear()
}

/** ¿Están TODAS estas columnas en `shop.<tabla>`? */
export async function shopTieneColumnas(tabla: "orders" | "order_items", columnas: readonly string[]): Promise<boolean> {
  const clave = `${tabla}:${columnas.join(",")}`
  const previa = cache.get(clave)
  if (previa?.ok) return true
  if (previa && Date.now() - previa.at < TTL_NEGATIVO_MS) return false

  const filas = await getDb().execute(sql`
    select count(*)::int as n from information_schema.columns
    where table_schema = 'shop' and table_name = ${tabla}
      and column_name in (${sql.join(columnas.map((c) => sql`${c}`), sql`, `)})
  `)
  const ok = Number((filas[0] as { n: number } | undefined)?.n ?? 0) === columnas.length
  cache.set(clave, { ok, at: Date.now() })
  return ok
}

export const COLUMNAS_CONTACTO = ["contactado_en", "contactado_por", "contactado_por_nombre"] as const

export const contactoDisponible = (): Promise<boolean> => shopTieneColumnas("orders", COLUMNAS_CONTACTO)
export const facturaCruzadaDisponible = (): Promise<boolean> => shopTieneColumnas("orders", ["factura_cruzada"])
