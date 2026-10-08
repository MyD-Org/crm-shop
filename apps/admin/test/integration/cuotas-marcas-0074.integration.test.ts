import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { crearMedioPago } from "@/lib/medios-pago-shop-repo"
import { seedLista } from "./precios-online-helpers"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0074 (change cuotas-en-el-formulario, rebanada 2): `lista_precio_condiciones.marcas`.
 * CHECK en la base, edición por el camino real (vista previa + aplicar), historial y undo. Datos
 * inventados.
 */

const A = "tenant-a"

let listaRef: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  listaRef = await seedLista(A, "Lista A", "1.2", { esReferencia: true, orden: 1 })
  await crearMedioPago(A, { slug: "tarjeta", nombre: "Tarjeta" })
})
afterAll(async () => {
  await truncateAll()
})

function insertar(cuotas: number | null, marcas: string[] | null) {
  return getDb().execute(sql`
    insert into lista_precio_condiciones (tenant_id, lista_id, medio_slug, cuotas, marcas)
    values (${A}, ${listaRef}, 'tarjeta', ${cuotas}, ${marcas === null ? null : sql`${`{${marcas.join(",")}}`}::text[]`})
  `)
}

describe("CHECK de la migración 0074", () => {
  it("rechaza marcas en la fila de pago único (cuotas NULL)", async () => {
    await expect(insertar(null, ["visa"])).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("rechaza un arreglo vacío", async () => {
    await expect(insertar(6, [])).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("rechaza ids con mayúsculas o símbolos", async () => {
    await expect(insertar(6, ["Visa"])).rejects.toMatchObject({ cause: { code: "23514" } })
    await expect(insertar(6, ["visa-debito"])).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("rechaza más de 20 marcas", async () => {
    const muchas = Array.from({ length: 21 }, (_, i) => `m${i}`)
    await expect(insertar(6, muchas)).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("acepta NULL (todas) y una lista válida en filas de cuotas", async () => {
    await insertar(3, null)
    await insertar(6, ["visa", "mastercard"])
    await insertar(null, null)
  })
})
