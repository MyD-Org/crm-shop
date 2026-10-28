import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { campaniaReglas, campanias, catalogProducts, preciosOnlineCambios } from "@/db/schema"
import {
  eliminarCampania,
  guardarCampania,
  leerCampania,
  listarCampanias,
  previsualizarCampania,
  terminarCampania,
} from "@/lib/campanias-repo"
import { previsualizarReversion, PreciosOnlineError } from "@/lib/precios-online-repo"
import type { CampaniaEntrada } from "@/lib/campanias-validar"
import { seedTenant, truncateAll } from "./helpers"
import { aplicar, seedCategoria, seedLista, seedProducto } from "./precios-online-helpers"

// Repositorio de campañas (spec 2026-10-28-campanias-precios-design.md) contra Postgres real.
// Datos inventados.

const T = "tenant-camp-repo"
const ACTOR = { id: "u1", name: "Operador", email: "operador@cliente.example" }

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedLista(T, "Tarjeta cuotas", "1.6", { esReferencia: true, orden: 0 })
  await seedLista(T, "Efectivo o Transferencia", "1.3", { orden: 1 })
  await seedProducto(T, { alegraId: "1", costo: "100", brand: "acme" })
  await seedProducto(T, { alegraId: "2", costo: "100", brand: "otra" })
  await aplicar(T, null, "config")
})
afterAll(async () => {
  await truncateAll()
})

async function ahoraDb(): Promise<Date> {
  const [r] = (await getDb().execute(sql`SELECT now() AS n`)) as unknown as { n: Date | string }[]
  return new Date(r.n)
}
const horas = (base: Date, h: number) => new Date(base.getTime() + h * 3_600_000).toISOString()

function entrada(ahora: Date, extra: Partial<CampaniaEntrada> = {}): CampaniaEntrada {
  return {
    nombre: "Black Friday",
    inicio: horas(ahora, -1),
    fin: horas(ahora, 24),
    reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 20 }],
    ...extra,
  }
}

async function campaniasDe(alegraId: string) {
  const [p] = await getDb()
    .select({ c: catalogProducts.campaniasOnline })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, T), eq(catalogProducts.alegraId, alegraId)))
  return p.c as { id: string; reglaId: string }[] | null
}

async function rechaza(p: Promise<unknown>): Promise<PreciosOnlineError> {
  try {
    await p
  } catch (e) {
    if (e instanceof PreciosOnlineError) return e
    throw e
  }
  throw new Error("se esperaba PreciosOnlineError")
}

describe("guardarCampania", () => {
  it("materializa la campaña y deja una entrada en el historial", async () => {
    const ahora = await ahoraDb()
    const { id } = await guardarCampania(T, entrada(ahora), ACTOR)
    expect((await campaniasDe("1"))?.map((e) => e.id)).toEqual([id])
    expect(await campaniasDe("2")).toBeNull()
    const hist = await getDb().select().from(preciosOnlineCambios).where(eq(preciosOnlineCambios.tenantId, T))
    expect(hist).toHaveLength(1)
    expect(hist[0]).toMatchObject({ tipo: "campania", objeto: `campania:${id}`, usuario: ACTOR.email })
  })

  it("rechaza una campaña que se superpone con otra; contiguas se pueden", async () => {
    const ahora = await ahoraDb()
    await guardarCampania(T, entrada(ahora, { inicio: horas(ahora, 1), fin: horas(ahora, 10) }), ACTOR)
    const e = await rechaza(guardarCampania(T, entrada(ahora, { inicio: horas(ahora, 5), fin: horas(ahora, 20) }), ACTOR))
    expect(e.status).toBe(409)
    expect(e.message).toContain("Black Friday")
    await expect(
      guardarCampania(T, entrada(ahora, { nombre: "Cyber Monday", inicio: horas(ahora, 10), fin: horas(ahora, 20) }), ACTOR),
    ).resolves.toMatchObject({ id: expect.any(String) })
  })

  it("al crear, el fin tiene que estar en el futuro", async () => {
    const ahora = await ahoraDb()
    const e = await rechaza(guardarCampania(T, entrada(ahora, { inicio: horas(ahora, -10), fin: horas(ahora, -1) }), ACTOR))
    expect(e.status).toBe(422)
  })

  it("editar conserva el id de una regla existente y borra sólo las que ya no están", async () => {
    const ahora = await ahoraDb()
    const { id } = await guardarCampania(
      T,
      entrada(ahora, {
        reglas: [
          { alcance: { tipo: "producto", alegraId: "1" }, pct: 20, unidades: 5 },
          { alcance: { tipo: "marca", marca: "otra" }, pct: 10 },
        ],
      }),
      ACTOR,
    )
    const antes = await getDb().select().from(campaniaReglas).where(eq(campaniaReglas.campaniaId, id))
    const idProducto = antes.find((r) => r.tipo === "producto")!.id

    await guardarCampania(
      T,
      entrada(ahora, { etiqueta: "BF", reglas: [{ alcance: { tipo: "producto", alegraId: "1" }, pct: 25, unidades: 5 }] }),
      ACTOR,
      id,
    )
    const despues = await getDb().select().from(campaniaReglas).where(eq(campaniaReglas.campaniaId, id))
    expect(despues).toHaveLength(1)
    expect(despues[0]).toMatchObject({ id: idProducto, pct: 25, unidades: 5 })
    expect((await campaniasDe("1"))?.[0].reglaId).toBe(idProducto)
    expect(await campaniasDe("2")).toBeNull()
  })

  it("una campaña activa no puede mover su inicio; una terminada no se edita", async () => {
    const ahora = await ahoraDb()
    const { id } = await guardarCampania(T, entrada(ahora), ACTOR)
    const e = await rechaza(guardarCampania(T, entrada(ahora, { inicio: horas(ahora, -2) }), ACTOR, id))
    expect(e.status).toBe(409)
    await getDb()
      .update(campanias)
      .set({ inicio: new Date(horas(ahora, -10)), fin: new Date(horas(ahora, -2)) })
      .where(eq(campanias.id, id))
    const e2 = await rechaza(
      guardarCampania(T, entrada(ahora, { inicio: horas(ahora, -10), fin: horas(ahora, 5) }), ACTOR, id),
    )
    expect(e2.status).toBe(409)
  })
})

describe("aislamiento por tenant", () => {
  it("una regla con una categoría de otro tenant se rechaza (al guardar y en la vista previa)", async () => {
    const ahora = await ahoraDb()
    await seedTenant("tenant-ajeno")
    const ajena = await seedCategoria("tenant-ajeno", "ajena")
    const e = entrada(ahora, { reglas: [{ alcance: { tipo: "categoria", categoriaId: ajena }, pct: 20 }] })
    const err = await rechaza(guardarCampania(T, e, ACTOR))
    expect(err.status).toBe(422)
    expect(err.message).toBe("Seleccione una categoría válida.")
    expect((await rechaza(previsualizarCampania(T, e))).status).toBe(422)
    expect(await getDb().select().from(campanias)).toHaveLength(0)
  })

  it("la vista previa con exceptoId de una campaña de otro tenant da 404 y no toca sus reglas", async () => {
    const ahora = await ahoraDb()
    await seedTenant("tenant-ajeno")
    const { id: ajena } = await guardarCampania("tenant-ajeno", entrada(ahora), ACTOR)
    const err = await rechaza(previsualizarCampania(T, entrada(ahora), ajena))
    expect(err.status).toBe(404)
    expect(await getDb().select().from(campaniaReglas).where(eq(campaniaReglas.campaniaId, ajena))).toHaveLength(1)
  })
})

describe("terminar y eliminar", () => {
  it("terminar una activa pone fin = ahora y el producto conserva la entrada (gracia de 24 h)", async () => {
    const ahora = await ahoraDb()
    const { id } = await guardarCampania(T, entrada(ahora), ACTOR)
    await terminarCampania(T, id, ACTOR)
    const [c] = await getDb().select().from(campanias).where(eq(campanias.id, id))
    expect(c.fin.getTime()).toBeLessThanOrEqual((await ahoraDb()).getTime())
    expect((await campaniasDe("1"))?.map((e) => e.id)).toEqual([id])
  })

  it("eliminar una activa tira; una programada se borra y deja de alcanzar al producto", async () => {
    const ahora = await ahoraDb()
    const { id: activa } = await guardarCampania(T, entrada(ahora), ACTOR)
    expect((await rechaza(eliminarCampania(T, activa, ACTOR))).status).toBe(409)
    const { id: prog } = await guardarCampania(
      T,
      entrada(ahora, { nombre: "Navidad", inicio: horas(ahora, 48), fin: horas(ahora, 72) }),
      ACTOR,
    )
    await eliminarCampania(T, prog, ACTOR)
    expect((await campaniasDe("1"))?.map((e) => e.id)).toEqual([activa])
    expect(await leerCampania(T, prog)).toBeNull()
  })

  it("terminar una programada tira", async () => {
    const ahora = await ahoraDb()
    const { id } = await guardarCampania(T, entrada(ahora, { inicio: horas(ahora, 2), fin: horas(ahora, 5) }), ACTOR)
    expect((await rechaza(terminarCampania(T, id, ACTOR))).status).toBe(409)
  })
})

describe("previsualizarCampania y listado", () => {
  it("cuenta productos, los que quedan bajo costo y no guarda nada", async () => {
    const ahora = await ahoraDb()
    const previa = await previsualizarCampania(T, entrada(ahora, { reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 50 }] }))
    expect(previa.productos).toBe(1)
    expect(previa.bajoCosto).toBe(1) // ×1,3 al 50 % = 65 < 100
    expect(previa.choque).toBeNull()
    expect(previa.muestra[0].precios.map((p) => [p.normal, p.campania])).toEqual([
      [160, 80],
      [130, 65],
    ])
    expect(await getDb().select().from(campanias)).toHaveLength(0)
    expect(await campaniasDe("1")).toBeNull()
  })

  it("informa el choque de fechas", async () => {
    const ahora = await ahoraDb()
    const { id } = await guardarCampania(T, entrada(ahora), ACTOR)
    const previa = await previsualizarCampania(T, entrada(ahora, { nombre: "Otra" }))
    expect(previa.choque).toEqual({ id, nombre: "Black Friday" })
    // Editándose a sí misma no choca.
    expect((await previsualizarCampania(T, entrada(ahora), id)).choque).toBeNull()
  })

  it("lista con estado y cantidad de productos", async () => {
    const ahora = await ahoraDb()
    const { id } = await guardarCampania(T, entrada(ahora), ACTOR)
    const l = await listarCampanias(T)
    expect(l).toEqual([expect.objectContaining({ id, nombre: "Black Friday", estado: "activa", productos: 1 })])
    const d = await leerCampania(T, id)
    expect(d?.reglas).toEqual([expect.objectContaining({ alcance: { tipo: "marca", marca: "acme" }, pct: 20 })])
  })
})

describe("historial de Precios online", () => {
  it("una entrada de campaña no se revierte desde Precios online", async () => {
    const ahora = await ahoraDb()
    await guardarCampania(T, entrada(ahora), ACTOR)
    const [h] = await getDb().select().from(preciosOnlineCambios).where(eq(preciosOnlineCambios.tenantId, T))
    const e = await rechaza(previsualizarReversion(T, h.id))
    expect(e.message).toBe("Las campañas se editan desde la solapa Campañas.")
  })
})
