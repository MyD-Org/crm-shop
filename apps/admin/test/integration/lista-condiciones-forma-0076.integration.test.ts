import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { seedLista } from "./precios-online-helpers"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0076 (change `listas-por-forma-de-pago`, rebanada A): `lista_precio_condiciones.forma`.
 * CHECK, índice único con coalesce y lectura del admin que ignora las filas por forma. Datos
 * inventados.
 */

const A = "tenant-a"

let lista: string

async function medio(slug: string) {
  await crearMedioPago(A, { slug: `${slug}-x`, nombre: slug })
  await getDb().execute(
    sql`update medios_pago_shop set slug = ${slug}, cobro_online = true where tenant_id = ${A} and slug = ${`${slug}-x`}`,
  )
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  lista = await seedLista(A, "Lista A", "1.2", { esReferencia: true, orden: 1 })
  await medio("mercadopago")
  await medio("payway")
})
afterAll(async () => {
  await truncateAll()
})

function insertar(slug: string, cuotas: number | null, forma: string | null) {
  return getDb().execute(sql`
    insert into lista_precio_condiciones (tenant_id, lista_id, medio_slug, cuotas, forma)
    values (${A}, ${lista}, ${slug}, ${cuotas}, ${forma})
  `)
}

describe("CHECK de la migración 0076", () => {
  it("rechaza forma en una fila de cuotas", async () => {
    await expect(insertar("mercadopago", 3, "credito")).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("rechaza una forma fuera del conjunto", async () => {
    await expect(insertar("mercadopago", null, "efectivo")).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("acepta credito, debito y cuenta_mp en el pago único", async () => {
    await insertar("mercadopago", null, "credito")
    await insertar("mercadopago", null, "debito")
    await insertar("mercadopago", null, "cuenta_mp")
  })
})

describe("índice único con forma", () => {
  for (const slug of ["mercadopago", "payway"]) {
    it(`${slug}: la fila NULL y la de débito coexisten`, async () => {
      await insertar(slug, null, null)
      await insertar(slug, null, "debito")
      const filas = await getDb().execute(
        sql`select forma from lista_precio_condiciones where tenant_id = ${A} and medio_slug = ${slug} order by forma nulls first`,
      )
      expect([...filas].map((r) => r.forma)).toEqual([null, "debito"])
    })

    it(`${slug}: rechaza un duplicado con forma y uno sin forma`, async () => {
      await insertar(slug, null, "debito")
      await expect(insertar(slug, null, "debito")).rejects.toMatchObject({ cause: { code: "23505" } })
      await insertar(slug, null, null)
      await expect(insertar(slug, null, null)).rejects.toMatchObject({ cause: { code: "23505" } })
    })
  }

  it("las filas de cuotas siguen siendo únicas y conviven con las de forma", async () => {
    await insertar("mercadopago", 3, null)
    await expect(insertar("mercadopago", 3, null)).rejects.toMatchObject({ cause: { code: "23505" } })
    await insertar("mercadopago", null, "credito")
  })
})

describe("lectura del admin", () => {
  it("listarMediosPago no toma una fila por forma como la lista del medio", async () => {
    await insertar("mercadopago", null, "debito")
    const sinNull = (await listarMediosPago(A)).find((m) => m.slug === "mercadopago")
    expect(sinNull?.listaOnlineId ?? null).toBeNull()

    await insertar("mercadopago", null, null)
    const conNull = (await listarMediosPago(A)).find((m) => m.slug === "mercadopago")
    expect(conNull?.listaOnlineId).toBe(lista)
  })
})
