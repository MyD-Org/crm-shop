import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"

// Test de CONTRATO del lado CRM (DAT-2 de portal-al-shop, PR-1b).
//
// El Shop lee (y en payment_receipts/notification_log escribe) tablas y la vista
// `alegra_contacts_shop` de `public`, cuyo DDL es de esta app. El Shop declara lo que usa en
// apps/clientes/src/db/crm.ts y lo congela en `__fixtures__/crm-contrato.json`
// ("public.<tabla>" → { columna: tipo SQL }); su propio test compara crm.ts con el fixture.
// Este test lee el MISMO fixture por ruta (sin importar código del Shop) y lo verifica contra
// crm_test migrado: si el CRM renombra, borra o cambia el tipo de una columna que el Shop usa,
// falla acá nombrando `tabla.columna`. Arreglo: migración nueva que conserve la columna, o
// cambio coordinado en el Shop (crm.ts + fixture) en el mismo PR.
//
// Mientras el fixture no esté en la rama (el Shop lo agrega en su PR de cuenta corriente),
// el test se saltea. Pero si ya existe el test del Shop que lo usa (crm-contrato.test.ts) y el
// fixture falta, eso es un error y falla: una vez que las dos piezas están, no hay skip posible.

const FIXTURE = fileURLToPath(
  new URL("../../../clientes/src/db/__fixtures__/crm-contrato.json", import.meta.url),
)
const TEST_DEL_SHOP = fileURLToPath(
  new URL("../../../clientes/src/db/crm-contrato.test.ts", import.meta.url),
)

type Contrato = Record<string, Record<string, string>>

// `getSQLType()` (lo que escribe el fixture) da "numeric(16, 2)"; `format_type` "numeric(16,2)".
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "")

async function columnasReales(schema: string, tabla: string): Promise<Map<string, string>> {
  // `data_type` pierde precisión/escala y dice ARRAY; `format_type` no. Incluye vistas.
  const filas = (await getDb().execute(sql`
    select c.column_name, format_type(a.atttypid, a.atttypmod) as tipo
    from information_schema.columns c
    join pg_attribute a
      on a.attrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
     and a.attname = c.column_name
    where c.table_schema = ${schema} and c.table_name = ${tabla}
  `)) as unknown as { column_name: string; tipo: string }[]
  return new Map(filas.map((f) => [f.column_name, f.tipo]))
}

/** Diferencias entre el contrato y la base, una por columna, nombrándola. */
async function diferenciasContrato(contrato: Contrato): Promise<string[]> {
  const problemas: string[] = []
  for (const [clave, columnas] of Object.entries(contrato)) {
    const [schema, tabla] = clave.includes(".") ? clave.split(".", 2) : ["public", clave]
    const reales = await columnasReales(schema, tabla)
    if (reales.size === 0) {
      problemas.push(`${clave}: no existe en la base`)
      continue
    }
    for (const [columna, tipo] of Object.entries(columnas)) {
      const real = reales.get(columna)
      if (real === undefined) problemas.push(`${clave}.${columna}: no existe en la base`)
      else if (norm(real) !== norm(tipo)) {
        problemas.push(`${clave}.${columna}: el Shop espera ${tipo}, la base tiene ${real}`)
      }
    }
  }
  return problemas
}

const hayFixture = existsSync(FIXTURE)
const hayTestDelShop = existsSync(TEST_DEL_SHOP)

describe("contrato: lo que el Shop lee de public existe en la base del CRM", () => {
  it("el fixture existe si el Shop ya tiene su test de contrato", () => {
    expect(
      hayFixture || !hayTestDelShop,
      `falta ${FIXTURE}: el Shop tiene crm-contrato.test.ts pero no el fixture que comparten las dos apps`,
    ).toBe(true)
  })

  describe.skipIf(!hayFixture)("contra crm_test migrado", () => {
    const contrato: Contrato = hayFixture ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {}

    it("el fixture declara al menos la vista y las tablas de cuenta corriente", () => {
      expect(Object.keys(contrato)).toEqual(
        expect.arrayContaining([
          "public.alegra_contacts_shop",
          "public.tenants",
          "public.payment_receipts",
          "public.notification_log",
        ]),
      )
    })

    it("cada tabla/columna/tipo del fixture existe igual en la base", async () => {
      expect(await diferenciasContrato(contrato)).toEqual([])
    })
  })

  // El verificador tiene que detectar el escenario "columna renombrada" (DAT-2) nombrando la
  // columna; se prueba con un contrato sintético para que corra aunque el fixture no esté.
  describe("el verificador nombra la columna que no coincide", () => {
    it("columna renombrada, tipo distinto y tabla inexistente", async () => {
      const problemas = await diferenciasContrato({
        "public.tenants": { id: "text", nombre_viejo: "text" },
        "public.alegra_contacts_shop": { credit_limit: "numeric(14, 2)", tenant_id: "text" },
        "public.tabla_que_no_existe": { id: "uuid" },
      })
      expect(problemas).toEqual([
        "public.tenants.nombre_viejo: no existe en la base",
        "public.alegra_contacts_shop.credit_limit: el Shop espera numeric(14, 2), la base tiene numeric(16,2)",
        "public.tabla_que_no_existe: no existe en la base",
      ])
    })
  })
})
