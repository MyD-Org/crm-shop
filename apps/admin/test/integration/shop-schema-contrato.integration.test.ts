import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { eq, sql } from "drizzle-orm"
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core"
import { getDb } from "@/db"
import { shopOrders, shopOrderItems } from "@/db/shop-schema"
import { seedShopOrder, seedShopOrderItem, truncateAll } from "./helpers"

// Test de CONTRATO entre las dos apps (ADM-10).
//
// El CRM declara a mano un subset de `shop.orders` / `shop.order_items` (src/db/shop-schema.ts)
// porque no puede importar el schema del Shop. Eso abre la puerta a la deriva silenciosa: el
// Shop renombra una columna, el CRM sigue compilando, y prod tira 500. Este test la cierra:
// el global-setup aplica las migraciones REALES del Shop a crm_test y acá se compara cada
// columna declarada contra el catálogo de Postgres.
//
// Si falla, el mensaje nombra `tabla.columna`. Arreglo habitual: actualizar shop-schema.ts
// para que coincida con el Shop (nunca al revés desde esta app).

interface ColumnaReal {
  column_name: string
  is_nullable: "YES" | "NO"
  column_default: string | null
  is_identity: "YES" | "NO"
  tipo: string
}

// `getSQLType()` da "numeric(14, 2)" y `format_type` "numeric(14,2)": se comparan sin espacios.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "")

async function columnasReales(schema: string, tabla: string): Promise<Map<string, ColumnaReal>> {
  // `data_type` de information_schema pierde precisión/escala; `format_type` no.
  const filas = (await getDb().execute(sql`
    select c.column_name, c.is_nullable, c.column_default, c.is_identity,
           format_type(a.atttypid, a.atttypmod) as tipo
    from information_schema.columns c
    join pg_attribute a
      on a.attrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
     and a.attname = c.column_name
    where c.table_schema = ${schema} and c.table_name = ${tabla}
  `)) as unknown as ColumnaReal[]
  return new Map(filas.map((f) => [f.column_name, f]))
}

const TABLAS: PgTable[] = [shopOrders, shopOrderItems]

describe("contrato: shop-schema.ts del CRM vs. las migraciones reales del Shop", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await truncateAll()
  })

  for (const tabla of TABLAS) {
    const { name, schema, columns } = getTableConfig(tabla)

    describe(`${schema}.${name}`, () => {
      it("está declarada en el esquema shop y existe en la base", async () => {
        expect(schema).toBe("shop")
        const reales = await columnasReales("shop", name)
        expect(reales.size, `la tabla shop.${name} no existe: ¿se aplicó la baseline del Shop?`).toBeGreaterThan(0)
      })

      it("cada columna declarada existe con el mismo tipo y la misma nulabilidad", async () => {
        const reales = await columnasReales("shop", name)
        const problemas: string[] = []
        for (const col of columns) {
          const real = reales.get(col.name)
          if (!real) {
            problemas.push(`${name}.${col.name}: no existe en la base`)
            continue
          }
          if (norm(col.getSQLType()) !== norm(real.tipo)) {
            problemas.push(`${name}.${col.name}: tipo declarado ${col.getSQLType()} ≠ real ${real.tipo}`)
          }
          if (col.notNull !== (real.is_nullable === "NO")) {
            problemas.push(
              `${name}.${col.name}: notNull declarado ${col.notNull} ≠ real is_nullable=${real.is_nullable}`,
            )
          }
        }
        expect(problemas).toEqual([])
      })

      it("inversa: toda columna real NOT NULL, sin default y no identity está declarada", async () => {
        // Si el Shop agrega una columna obligatoria sin default, los inserts de los seeds de
        // este lado fallarían con un error de Postgres poco claro. Acá falla con nombre.
        const reales = await columnasReales("shop", name)
        const declaradas = new Set(columns.map((c) => c.name))
        const faltantes = [...reales.values()]
          .filter((r) => r.is_nullable === "NO" && r.column_default === null && r.is_identity === "NO")
          .filter((r) => !declaradas.has(r.column_name))
          .map((r) => `${name}.${r.column_name}`)
        expect(faltantes).toEqual([])
      })
    })
  }

  it("numero es identity en la base (por eso el subset lo declara generatedAlwaysAsIdentity)", async () => {
    const reales = await columnasReales("shop", "orders")
    expect(reales.get("numero")?.is_identity).toBe("YES")
  })

  it("los dos CHECK de orders existen", async () => {
    const filas = (await getDb().execute(sql`
      select conname from pg_constraint
      where conrelid = '"shop"."orders"'::regclass and contype = 'c'
    `)) as unknown as { conname: string }[]
    const nombres = filas.map((f) => f.conname)
    expect(nombres).toContain("orders_estado_check")
    expect(nombres).toContain("orders_cancelacion_motivo_check")
  })

  it("bookkeeping separado: la baseline vive en shop.__drizzle_migrations, no en el del CRM", async () => {
    const [shopBk] = (await getDb().execute(
      sql`select count(*)::int as n from shop.__drizzle_migrations`,
    )) as unknown as { n: number }[]
    expect(shopBk.n).toBe(1)

    // El bookkeeping del CRM tiene exactamente sus migraciones: la del Shop no se coló ahí.
    // Se cuenta el journal y no los .sql: en drizzle/ hay un .sql histórico fuera del journal.
    const { readFileSync } = await import("node:fs")
    const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }
    const propias = journal.entries.length
    const [crmBk] = (await getDb().execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    )) as unknown as { n: number }[]
    expect(crmBk.n).toBe(propias)
  })

  describe("reglas que la base hace cumplir a las DOS apps", () => {
    it("SDB-7: los 6 estados válidos se aceptan por SQL crudo", async () => {
      const pedido = await seedShopOrder("tenant-a")
      for (const estado of ["confirmado", "preparacion", "en_camino", "entregado", "pendiente"]) {
        await getDb().execute(sql`update shop.orders set estado = ${estado} where id = ${pedido.id}`)
      }
      await getDb().execute(
        sql`update shop.orders set estado = 'cancelado', cancelacion_motivo = 'prueba' where id = ${pedido.id}`,
      )
      const [fila] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, pedido.id))
      expect(fila.estado).toBe("cancelado")
    })

    it("SDB-7: un estado desconocido viola orders_estado_check y la fila no cambia", async () => {
      const pedido = await seedShopOrder("tenant-a")
      await expect(
        getDb().execute(sql`update shop.orders set estado = 'despachado' where id = ${pedido.id}`),
      ).rejects.toMatchObject({ cause: { constraint_name: "orders_estado_check" } })
      const [fila] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, pedido.id))
      expect(fila.estado).toBe("pendiente")
    })

    it("cancelar sin motivo viola orders_cancelacion_motivo_check", async () => {
      const pedido = await seedShopOrder("tenant-a")
      await expect(
        getDb().execute(sql`update shop.orders set estado = 'cancelado' where id = ${pedido.id}`),
      ).rejects.toMatchObject({ cause: { constraint_name: "orders_cancelacion_motivo_check" } })
      const [fila] = await getDb().select().from(shopOrders).where(eq(shopOrders.id, pedido.id))
      expect(fila.estado).toBe("pendiente")
    })

    it("SDB-6: un INSERT sin tenant_id se rechaza", async () => {
      await expect(
        getDb().execute(sql`
          insert into shop.orders (contacto_nombre, contacto_telefono, entrega_tipo, pago_metodo, subtotal, iva, total)
          values ('Sin Tenant', '000', 'retiro', 'a_coordinar', 1, 0, 1)
        `),
      ).rejects.toMatchObject({ cause: { code: "23502", column_name: "tenant_id" } })
    })
  })

  describe("aislamiento entre tests: truncateAll limpia las tablas del Shop", () => {
    // Dos tests consecutivos que siembran: si truncateAll no limpiara shop.*, el segundo
    // arrancaría con las filas del primero.
    it("primero: siembra un pedido con un ítem", async () => {
      expect(await getDb().select().from(shopOrders)).toHaveLength(0)
      const pedido = await seedShopOrder("tenant-a")
      await seedShopOrderItem(pedido.id)
      expect(await getDb().select().from(shopOrderItems)).toHaveLength(1)
    })

    it("segundo: arranca con shop.orders y shop.order_items vacías", async () => {
      expect(await getDb().select().from(shopOrders)).toHaveLength(0)
      expect(await getDb().select().from(shopOrderItems)).toHaveLength(0)
    })
  })
})
