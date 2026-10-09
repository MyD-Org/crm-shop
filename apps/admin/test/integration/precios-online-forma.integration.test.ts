import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { CambioPrecios } from "@/lib/precios-online-cambios"
import { crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import {
  PreciosOnlineError,
  aplicarCambios,
  aplicarReversion,
  listarHistorial,
  previsualizar,
  previsualizarReversion,
  type UsuarioActor,
} from "@/lib/precios-online-repo"
import { seedLista } from "./precios-online-helpers"
import { seedTenant, truncateAll } from "./helpers"

// Rebanada B de `listas-por-forma-de-pago`: setCondicion con forma (pago único de Mercado Pago y
// Payway), historial con la forma en la clave y revert. Datos inventados.

const T = "tenant-forma"
const OTRO = "tenant-otro-forma"
const ANA: UsuarioActor = { id: "u1", name: "Ana Admin", email: "ana.admin@example.com" }

let listaA: string
let listaB: string
let listaC: string

const literal = (xs: string[]) => `{${xs.join(",")}}`
async function opciones(slug: string, xs: string[]) {
  await getDb().execute(sql`update medios_pago_shop set opciones_cobro = ${literal(xs)}::text[] where tenant_id = ${T} and slug = ${slug}`)
}

async function medio(slug: string, opciones: string[]) {
  await crearMedioPago(T, { slug: `${slug}-x`, nombre: slug })
  await getDb().execute(
    sql`update medios_pago_shop set slug = ${slug}, cobro_online = true, opciones_cobro = ${literal(opciones)}::text[]
        where tenant_id = ${T} and slug = ${`${slug}-x`}`,
  )
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
  listaA = await seedLista(T, "Lista A", "1.2", { esReferencia: true, orden: 1 })
  listaB = await seedLista(T, "Lista B", "1.3", { orden: 2 })
  listaC = await seedLista(T, "Lista C", "1.4", { orden: 3 })
  await medio("mercadopago", ["credito", "debito", "cuenta_mp"])
  await medio("payway", ["credito", "debito"])
})
afterAll(async () => {
  await truncateAll()
})

async function aplicar(cambios: CambioPrecios[], tenant = T) {
  const p = await previsualizar(tenant, cambios)
  return aplicarCambios(tenant, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella })
}
const set = (medioSlug: string, listaId: string | null, forma?: "credito" | "debito" | "cuenta_mp" | null): CambioPrecios => ({
  op: "setCondicion",
  medioSlug,
  cuotas: null,
  listaId,
  ...(forma !== undefined ? { forma } : {}),
})
const error = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as PreciosOnlineError
  }
  throw new Error("no falló")
}
const filas = async () =>
  [
    ...(await getDb().execute(
      sql`select medio_slug, cuotas, forma, lista_id from lista_precio_condiciones where tenant_id = ${T} order by medio_slug, forma nulls first`,
    )),
  ].map((r) => ({ medio: r.medio_slug as string, forma: r.forma as string | null, lista: r.lista_id as string }))
const historial = async () => (await listarHistorial(T, { start: 0, limit: 20 })).items

describe("setCondicion con forma: alta, cambio y baja", () => {
  for (const slug of ["mercadopago", "payway"]) {
    it(`${slug}: alta, cambio y baja de la fila de débito sin tocar la de todas las formas`, async () => {
      await aplicar([set(slug, listaA)])
      await aplicar([set(slug, listaB, "debito")])
      expect(await filas()).toEqual([
        { medio: slug, forma: null, lista: listaA },
        { medio: slug, forma: "debito", lista: listaB },
      ])
      await aplicar([set(slug, listaC, "debito")])
      expect((await filas()).find((f) => f.forma === "debito")?.lista).toBe(listaC)
      await aplicar([set(slug, null, "debito")])
      expect(await filas()).toEqual([{ medio: slug, forma: null, lista: listaA }])
    })
  }

  it("mercadopago acepta cuenta_mp si está habilitada", async () => {
    await aplicar([set("mercadopago", listaB, "cuenta_mp")])
    expect((await filas())[0]).toMatchObject({ forma: "cuenta_mp", lista: listaB })
  })

  it("el DTO del medio trae las listas por forma en orden canónico", async () => {
    await aplicar([set("mercadopago", listaB, "debito"), set("mercadopago", listaC, "credito")])
    const mp = (await listarMediosPago(T)).find((m) => m.slug === "mercadopago")
    expect(mp?.listasPorForma.map((l) => [l.forma, l.listaId, l.listaNombre])).toEqual([
      ["credito", listaC, "Lista C"],
      ["debito", listaB, "Lista B"],
    ])
    expect(mp?.listaOnlineId).toBeNull()
  })
})

describe("setCondicion con forma: rechazos", () => {
  it("forma no habilitada en el medio => 422 forma_no_habilitada y no escribe", async () => {
    await opciones("payway", ["credito"])
    expect(await error(aplicar([set("payway", listaB, "debito")]))).toMatchObject({ status: 422, code: "forma_no_habilitada" })
    expect(await filas()).toEqual([])
  })

  it("cuenta_mp en payway se rechaza aunque el medio la tenga guardada", async () => {
    await opciones("payway", ["credito", "debito", "cuenta_mp"])
    expect(await error(aplicar([set("payway", listaB, "cuenta_mp")]))).toMatchObject({ status: 422 })
    expect(await filas()).toEqual([])
  })

  it("mercadopago con crédito y débito (sin cuenta MP) no acepta cuenta_mp", async () => {
    await opciones("mercadopago", ["credito", "debito"])
    expect(await error(aplicar([set("mercadopago", listaB, "cuenta_mp")]))).toMatchObject({ code: "forma_no_habilitada" })
  })

  it("quitar la lista de una forma que ya no está habilitada siempre se permite", async () => {
    await aplicar([set("mercadopago", listaB, "cuenta_mp")])
    await opciones("mercadopago", ["credito", "debito"])
    await aplicar([set("mercadopago", null, "cuenta_mp")])
    expect(await filas()).toEqual([])
  })

  it("lista de otro tenant => rechazada y no escribe", async () => {
    const ajena = await seedLista(OTRO, "Lista ajena", "1.2", { esReferencia: true })
    expect(await error(aplicar([set("mercadopago", ajena, "debito")]))).toBeInstanceOf(PreciosOnlineError)
    expect(await filas()).toEqual([])
  })

  it("forma en un medio que no es de cobro o con cuotas => rechazo de validación", async () => {
    await medio("transferencia", [])
    expect(await error(aplicar([set("transferencia", listaB, "debito")]))).toBeDefined()
    expect(
      await error(aplicar([{ op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: listaB, forma: "credito" }])),
    ).toBeDefined()
  })
})

describe("historial y revert con la forma en la clave", () => {
  it("la clave del objeto incluye la forma; sin forma queda la de siempre", async () => {
    await aplicar([set("mercadopago", listaA)])
    await aplicar([set("mercadopago", listaB, "debito")])
    const objetos = (await historial()).map((h) => h.objeto)
    expect(objetos).toContain("condicion:mercadopago:0")
    expect(objetos).toContain("condicion:mercadopago:0:debito")
  })

  it("revertir la forma restaura sólo su fila; la de todas las formas no cambia", async () => {
    await aplicar([set("mercadopago", listaA)])
    await aplicar([set("mercadopago", listaB, "debito")])
    await aplicar([set("mercadopago", listaC, "debito")])
    const entrada = (await historial())[0]
    expect(entrada.objeto).toBe("condicion:mercadopago:0:debito")
    const previa = await previsualizarReversion(T, entrada.id)
    await aplicarReversion(T, ANA, entrada.id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    expect(await filas()).toEqual([
      { medio: "mercadopago", forma: null, lista: listaA },
      { medio: "mercadopago", forma: "debito", lista: listaB },
    ])
  })

  it("revertir el alta de una forma la borra; una edición posterior de otra forma no choca", async () => {
    await aplicar([set("mercadopago", listaB, "debito")])
    const alta = (await historial())[0]
    await aplicar([set("mercadopago", listaC, "credito")])
    const previa = await previsualizarReversion(T, alta.id)
    await aplicarReversion(T, ANA, alta.id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    expect(await filas()).toEqual([{ medio: "mercadopago", forma: "credito", lista: listaC }])
  })

  it("una entrada vieja (sin forma) se revierte sobre la fila de todas las formas", async () => {
    await aplicar([set("mercadopago", listaA)])
    await aplicar([set("mercadopago", listaB, "debito")])
    await aplicar([set("mercadopago", listaB)])
    const entrada = (await historial())[0]
    // Simula una entrada anterior a la 0076: sin `forma` en antes/despues.
    await getDb().execute(sql`
      update precios_online_cambios
      set antes = antes - 'forma', despues = despues - 'forma'
      where id = ${entrada.id}`)
    const previa = await previsualizarReversion(T, entrada.id)
    await aplicarReversion(T, ANA, entrada.id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    expect(await filas()).toEqual([
      { medio: "mercadopago", forma: null, lista: listaA },
      { medio: "mercadopago", forma: "debito", lista: listaB },
    ])
  })
})
