import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { aplicarCambios, aplicarReversion, listarHistorial, previsualizar, previsualizarReversion } from "@/lib/precios-online-repo"
import type { CambioPrecios } from "@/lib/precios-online-cambios"
import { seedLista, seedProducto } from "./precios-online-helpers"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0074 (change cuotas-en-el-formulario, rebanada 2): `lista_precio_condiciones.marcas`.
 * CHECK en la base, edición por el camino real (vista previa + aplicar), historial y undo. Datos
 * inventados.
 */

const A = "tenant-a"
const USUARIO = { id: "u1", name: "Ana", email: "ana@cliente.example" }

let listaRef: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  listaRef = await seedLista(A, "Lista A", "1.2", { esReferencia: true, orden: 1 })
  await seedProducto(A, { alegraId: "p1", costo: "100" })
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

async function cambiar(cambios: CambioPrecios[]) {
  const previa = await previsualizar(A, cambios)
  await aplicarCambios(A, USUARIO, { cambios, baseVersion: previa.baseVersion, huella: previa.huella })
}

async function error(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return e as { status?: number; code?: string }
  }
  return null
}

async function condicion6() {
  const [mp] = await listarMediosPago(A)
  return mp.condicionesCuotas.find((c) => c.cuotas === 6)
}

async function deshacerUltimo() {
  const hist = (await listarHistorial(A, { start: 0, limit: 10 })).items
  const previa = await previsualizarReversion(A, hist[0].id)
  await aplicarReversion(A, USUARIO, hist[0].id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
}

describe("setCondicion con marcas", () => {
  it("las marcas llegan al DTO del medio; sin marcas = null (todas)", async () => {
    await cambiar([
      { op: "setCondicion", medioSlug: "tarjeta", cuotas: 3, listaId: listaRef },
      { op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["visa", "mastercard"] },
    ])
    const [mp] = await listarMediosPago(A)
    expect(mp.condicionesCuotas.map((c) => [c.cuotas, c.marcas])).toEqual([
      [3, null],
      [6, ["visa", "mastercard"]],
    ])
  })

  it("cambiar solo las marcas se versiona y entra al historial con antes/después", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["visa"] }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["visa", "mastercard"] }])
    expect((await condicion6())?.marcas).toEqual(["visa", "mastercard"])
    const hist = (await listarHistorial(A, { start: 0, limit: 10 })).items
    expect(hist[0]).toMatchObject({ tipo: "condicion", antes: { marcas: ["visa"] }, despues: { marcas: ["visa", "mastercard"] } })
  })

  it("las mismas marcas en otro orden son sin_cambios", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["visa", "mastercard"] }])
    const e = await error(
      previsualizar(A, [{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["mastercard", "visa"] }]),
    )
    expect(e).toMatchObject({ status: 422, code: "sin_cambios" })
  })

  it("marcas en el pago único se rechazan (422)", async () => {
    const e = await error(previsualizar(A, [{ op: "setCondicion", medioSlug: "tarjeta", cuotas: null, listaId: listaRef, marcas: ["visa"] }]))
    expect(e).toMatchObject({ status: 422 })
  })

  it("deshacer restaura las marcas anteriores", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["visa"] }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: null }])
    await deshacerUltimo()
    expect((await condicion6())?.marcas).toEqual(["visa"])
  })

  it("deshacer la baja de una condición con marcas la restaura con sus marcas", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["amex"] }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: null }])
    await deshacerUltimo()
    expect((await condicion6())?.marcas).toEqual(["amex"])
  })

  it("una entrada vieja del historial (sin `marcas`) restaura todas las tarjetas", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["visa"] }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, marcas: ["amex"] }])
    // Simula una entrada anterior a la 0074: el snapshot `antes` no tiene la clave.
    await getDb().execute(sql`
      update precios_online_cambios set antes = antes - 'marcas'
      where id = (select id from precios_online_cambios where tenant_id = ${A} order by creado_at desc, id desc limit 1)
    `)
    await deshacerUltimo()
    expect((await condicion6())?.marcas).toBeNull()
  })
})

describe("shop_app lee las marcas con el GRANT de tabla entera (0065)", () => {
  it("la 0074 no agrega GRANT y shop_app lee la columna; la transacción se revierte", async () => {
    const sinComentarios = readFileSync("drizzle/0074_cuotas_marcas.sql", "utf8").replace(/^--.*$/gm, "")
    expect(sinComentarios.toUpperCase()).not.toContain("GRANT ")
    await insertar(6, ["visa"])
    const sqlMigracion = readFileSync("drizzle/0065_shop_precios_online.sql", "utf8")
    const bloque = sqlMigracion.slice(sqlMigracion.lastIndexOf("DO $$"))
    const ROLLBACK = new Error("rollback")
    let filas: { cuotas: number; marcas: string[] | null }[] = []
    await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql.raw(bloque))
        await tx.execute(sql`SET LOCAL ROLE shop_app`)
        filas = (await tx.execute(sql`select cuotas, marcas from public.lista_precio_condiciones`)) as unknown as typeof filas
        throw ROLLBACK
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e
      })
    expect(filas).toEqual([{ cuotas: 6, marcas: ["visa"] }])
  })
})
