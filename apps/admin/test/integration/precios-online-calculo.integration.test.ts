import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts, listasPrecioOnline, preciosOnlineConfig, preciosOnlineRetenciones } from "@/db/schema"
import {
  calcularOraculo,
  type CategoriaOraculo,
  type ListaOraculo,
  type OverrideOraculo,
} from "@/lib/precios-online-oraculo"
import { seedTenant, truncateAll } from "./helpers"
import {
  aplicar,
  calcular,
  seedCategoria,
  seedLista,
  seedOverrideCategoria,
  seedOverrideMarca,
  seedProducto,
} from "./precios-online-helpers"

// B.4–B.7: `calcular_precios_online` y `aplicar_precios_online` (migración 0064) contra Postgres
// real. El SQL se contrasta con el oráculo en TypeScript (matriz fija + barrido aleatorio con
// semilla fija). Datos inventados.

const T = "tenant-po"
const OTRO = "tenant-otro"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})
afterAll(async () => {
  await truncateAll()
})

describe("calcular_precios_online: precedencia y redondeo", () => {
  it("general: costo 100 x 1,6 = 160,00", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const [r] = await calcular(T)
    expect(r).toMatchObject({ coef: "1.6000", origen: "general", precio: "160.00" })
  })

  it("categoría, ancestro más cercano, herencia y override propio de la subcategoría", async () => {
    const lista = await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const raiz = await seedCategoria(T, "raiz")
    const hija = await seedCategoria(T, "hija", raiz, 2)
    const nieta = await seedCategoria(T, "nieta", hija, 3)
    await seedOverrideCategoria(T, lista, raiz, "1.4")
    await seedOverrideCategoria(T, lista, hija, "1.3")
    await seedProducto(T, { alegraId: "n", costo: "100", categoriaId: nieta })
    await seedProducto(T, { alegraId: "h", costo: "100", categoriaId: hija })
    await seedProducto(T, { alegraId: "r", costo: "100", categoriaId: raiz })
    const por = Object.fromEntries((await calcular(T)).map((r) => [r.alegra_id, r]))
    expect(por.n).toMatchObject({ coef: "1.3000", origen: `categoria:${hija}`, precio: "130.00" }) // más cercano
    expect(por.h).toMatchObject({ coef: "1.3000", origen: `categoria:${hija}` })
    expect(por.r).toMatchObject({ coef: "1.4000", origen: `categoria:${raiz}`, precio: "140.00" })
    await seedOverrideCategoria(T, lista, nieta, "1.2")
    const n2 = (await calcular(T, ["n"]))[0]
    expect(n2).toMatchObject({ coef: "1.2000", origen: `categoria:${nieta}` })
  })

  it("marca gana sobre categoría; marca vacía y sin categoría propia usan marca o general", async () => {
    const lista = await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const cat = await seedCategoria(T, "cat")
    await seedOverrideCategoria(T, lista, cat, "1.3")
    await seedOverrideMarca(T, lista, "marca x", "1.5")
    await seedProducto(T, { alegraId: "m", costo: "100", brand: "  Marca X ", categoriaId: cat })
    await seedProducto(T, { alegraId: "c", costo: "100", brand: null, categoriaId: cat })
    await seedProducto(T, { alegraId: "g", costo: "100", brand: "Otra" })
    await seedProducto(T, { alegraId: "v", costo: "100", brand: "   " })
    const por = Object.fromEntries((await calcular(T)).map((r) => [r.alegra_id, r]))
    expect(por.m).toMatchObject({ coef: "1.5000", origen: "marca:marca x" })
    expect(por.c).toMatchObject({ coef: "1.3000", origen: `categoria:${cat}` })
    expect(por.g).toMatchObject({ origen: "general" })
    expect(por.v).toMatchObject({ origen: "general" })
  })

  it("redondeo half-up: 33,33 x 1,25 = 41,66 y 0,02 x 1,25 = 0,03", async () => {
    await seedLista(T, "Lista A", "1.25", { esReferencia: true })
    await seedProducto(T, { alegraId: "a", costo: "33.33" })
    await seedProducto(T, { alegraId: "b", costo: "0.02" })
    const por = Object.fromEntries((await calcular(T)).map((r) => [r.alegra_id, r.precio]))
    expect(por).toEqual({ a: "41.66", b: "0.03" })
  })

  it("costo nulo o 0 => sin precio (nunca 0); lista inactiva no emite", async () => {
    await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedLista(T, "Lista vieja", "1.9", { activa: false })
    await seedProducto(T, { alegraId: "n", costo: null })
    await seedProducto(T, { alegraId: "z", costo: "0", costoAplicado: "0" })
    const filas = await calcular(T)
    expect(filas).toHaveLength(2) // una sola lista activa x 2 productos
    expect(filas.every((f) => f.precio === null)).toBe(true)
  })

  it("usa costo_aplicado, no costo", async () => {
    await seedLista(T, "Lista A", "2", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "200", costoAplicado: "100" })
    expect((await calcular(T))[0].precio).toBe("200.00")
  })

  it("NO lee precios_alegra ni prices: cambiarlos no altera el resultado", async () => {
    await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100", rawPrice: [{ idPriceList: "1", name: "X", price: 5 }] })
    await seedProducto(T, { alegraId: "2", costo: "100", rawPrice: [{ idPriceList: "1", name: "X", price: 99999 }] })
    const antes = await calcular(T)
    await getDb()
      .update(catalogProducts)
      .set({ raw: { price: [{ idPriceList: "9", name: "Y", price: 1 }] }, prices: [{ idPriceList: "9", name: "Y", price: 7 }] })
    expect(await calcular(T)).toEqual(antes)
    expect(antes.map((f) => f.precio)).toEqual(["150.00", "150.00"])
  })

  it("aísla por tenant", async () => {
    await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedLista(OTRO, "Lista A", "3", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(OTRO, { alegraId: "1", costo: "100" })
    expect((await calcular(T)).map((f) => f.precio)).toEqual(["150.00"])
    expect((await calcular(OTRO)).map((f) => f.precio)).toEqual(["300.00"])
  })

  it("masivo y por ítem son idénticos", async () => {
    const lista = await seedLista(T, "Lista A", "1.45", { esReferencia: true })
    await seedLista(T, "Lista B", "1.2")
    await seedOverrideMarca(T, lista, "marca x", "1.7")
    for (let i = 0; i < 12; i++) await seedProducto(T, { alegraId: `p${i}`, costo: `${10 + i * 3.37}`, brand: i % 2 ? "Marca X" : "Y" })
    const masivo = await calcular(T)
    const porItem = (await Promise.all(Array.from({ length: 12 }, (_, i) => calcular(T, [`p${i}`])))).flat()
    const clave = (f: { alegra_id: string; lista_id: string }) => `${f.alegra_id}|${f.lista_id}`
    expect([...porItem].sort((a, b) => clave(a).localeCompare(clave(b)))).toEqual(
      [...masivo].sort((a, b) => clave(a).localeCompare(clave(b))),
    )
  })
})

describe("calcular_precios_online contra el oráculo (barrido con semilla fija)", () => {
  // PRNG determinístico (mulberry32).
  function rng(seed: number) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const dec = (r: () => number, max: number, d: number) => (r() * max).toFixed(d)

  it("200 productos aleatorios coinciden con el oráculo", async () => {
    const r = rng(20261006)
    // Árbol: 3 raíces, cada una con 2 hijas, cada hija con 1 nieta.
    const cats: CategoriaOraculo[] = []
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const raiz = await seedCategoria(T, `r${i}`)
      cats.push({ id: raiz, parentId: null, nivel: 1 })
      ids.push(raiz)
      for (let j = 0; j < 2; j++) {
        const hija = await seedCategoria(T, `h${i}${j}`, raiz, 2)
        cats.push({ id: hija, parentId: raiz, nivel: 2 })
        ids.push(hija)
        const nieta = await seedCategoria(T, `n${i}${j}`, hija, 3)
        cats.push({ id: nieta, parentId: hija, nivel: 3 })
        ids.push(nieta)
      }
    }
    const marcas = ["marca a", "marca b", "marca c"]
    const listasOra: ListaOraculo[] = []
    for (let l = 0; l < 3; l++) {
      const coef = (1 + r() * 1.5).toFixed(4)
      const id = await seedLista(T, `Lista ${l}`, coef, { esReferencia: l === 0, orden: l, activa: l !== 2 || r() > 0.5 })
      const activa = (await getDb().select().from(listasPrecioOnline).where(eq(listasPrecioOnline.id, id)))[0].activa
      const overrides: OverrideOraculo[] = []
      for (const m of marcas) {
        if (r() < 0.4) {
          const c = (1 + r() * 1.5).toFixed(4)
          await seedOverrideMarca(T, id, m, c)
          overrides.push({ tipo: "marca", marca: m, coeficiente: c })
        }
      }
      for (const cid of ids) {
        if (r() < 0.3) {
          const c = (1 + r() * 1.5).toFixed(4)
          await seedOverrideCategoria(T, id, cid, c)
          overrides.push({ tipo: "categoria", categoriaId: cid, coeficiente: c })
        }
      }
      listasOra.push({ id, coeficiente: coef, activa, overrides })
    }
    const productos: { alegraId: string; costo: string | null; marca: string | null; cat: string | null }[] = []
    for (let i = 0; i < 200; i++) {
      const sinCosto = r() < 0.1
      const p = {
        alegraId: `p${i}`,
        costo: sinCosto ? null : dec(r, 5000, 4),
        marca: r() < 0.7 ? marcas[Math.floor(r() * 3)] : null,
        cat: r() < 0.8 ? ids[Math.floor(r() * ids.length)] : null,
      }
      productos.push(p)
      await seedProducto(T, { alegraId: p.alegraId, costo: p.costo, brand: p.marca, categoriaId: p.cat })
    }
    const sql_ = await calcular(T)
    const porClave = new Map(sql_.map((f) => [`${f.alegra_id}|${f.lista_id}`, f]))
    let comparados = 0
    for (const p of productos) {
      const esperado = calcularOraculo({ costo: p.costo, marca: p.marca, categorias: p.cat ? [p.cat] : [] }, listasOra, cats)
      for (const e of esperado) {
        const f = porClave.get(`${p.alegraId}|${e.listaId}`)
        expect(f, `${p.alegraId}`).toBeDefined()
        expect({ coef: f!.coef, origen: f!.origen, precio: f!.precio }).toEqual({ coef: e.coef, origen: e.origen, precio: e.precio })
        comparados++
      }
    }
    expect(comparados).toBeGreaterThan(300)
    expect(sql_.length).toBe(comparados) // el SQL no emite filas de más (listas inactivas)
  })
})

describe("aplicar_precios_online modo config", () => {
  it("escribe precios_online (shape del Shop) y precio_online_ref, solo lo que difiere, e idempotente", async () => {
    const ref = await seedLista(T, "Lista A", "1.5", { esReferencia: true, orden: 1 })
    const otra = await seedLista(T, "Lista B", "1.2", { orden: 2 })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "2", costo: null })
    const r1 = await aplicar(T, null, "config")
    expect(r1.actualizados).toBe(1)
    const [p] = await getDb().select().from(catalogProducts).where(eq(catalogProducts.alegraId, "1"))
    expect(p.preciosOnline).toEqual([
      { idPriceList: ref, name: "Lista A", price: 150, main: true },
      { idPriceList: otra, name: "Lista B", price: 120, main: false },
    ])
    expect(p.precioOnlineRef).toBe("150.00")
    const [sinCosto] = await getDb().select().from(catalogProducts).where(eq(catalogProducts.alegraId, "2"))
    expect(sinCosto.preciosOnline).toEqual([])
    expect(sinCosto.precioOnlineRef).toBeNull()
    const r2 = await aplicar(T, null, "config")
    expect(r2.actualizados).toBe(0) // idempotente
  })

  it("sin listas deja '[]' y limpia lo que había", async () => {
    const id = await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await getDb().delete(listasPrecioOnline).where(eq(listasPrecioOnline.id, id))
    await aplicar(T, null, "config")
    const [p] = await getDb().select().from(catalogProducts)
    expect(p.preciosOnline).toEqual([])
    expect(p.precioOnlineRef).toBeNull()
  })
})

describe("aplicar_precios_online modo costo (retención)", () => {
  async function setCosto(alegraId: string, costo: string | null) {
    await getDb().update(catalogProducts).set({ costo }).where(eq(catalogProducts.alegraId, alegraId))
  }
  const fila = async (alegraId: string) =>
    (await getDb().select().from(catalogProducts).where(eq(catalogProducts.alegraId, alegraId)))[0]
  const retenciones = () => getDb().select().from(preciosOnlineRetenciones)

  beforeEach(async () => {
    await seedLista(T, "Lista A", "2", { esReferencia: true })
  })

  it("el primer costo se aplica", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100", costoAplicado: null })
    const r = await aplicar(T, ["1"], "costo")
    expect(r.retenidos).toBe(0)
    expect((await fila("1")).costoAplicado).toBe("100.0000")
    expect((await fila("1")).precioOnlineRef).toBe("200.00")
  })

  it("variación por debajo del umbral aplica solo", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "105")
    await aplicar(T, ["1"], "costo")
    expect((await fila("1")).precioOnlineRef).toBe("210.00")
    expect(await retenciones()).toHaveLength(0)
  })

  it("exactamente 10 % aplica; 10,01 % retiene", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "2", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "110")
    await setCosto("2", "110.01")
    const r = await aplicar(T, null, "costo")
    expect(r.retenidos).toBe(1)
    expect((await fila("1")).precioOnlineRef).toBe("220.00")
    expect((await fila("2")).precioOnlineRef).toBe("200.00") // vigente intacto
    expect((await fila("2")).costoAplicado).toBe("100.0000")
    const [ret] = await retenciones()
    expect(ret).toMatchObject({ alegraId: "2", estado: "pendiente", costoVigente: "100.0000", costoPropuesto: "110.0100" })
  })

  it("variación grande retiene: sigue el precio vigente y queda pendiente", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "125")
    await aplicar(T, ["1"], "costo")
    expect((await fila("1")).precioOnlineRef).toBe("200.00")
    expect((await retenciones())[0]).toMatchObject({ estado: "pendiente", variacionPct: "25.00" })
    // Un recálculo de config no evapora la retención: usa costo_aplicado.
    await aplicar(T, null, "config")
    expect((await fila("1")).precioOnlineRef).toBe("200.00")
  })

  it("caer a NULL retiene y mantiene el precio (alerta sin costo)", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", null)
    const r = await aplicar(T, ["1"], "costo")
    expect(r.retenidos).toBe(1)
    expect((await fila("1")).precioOnlineRef).toBe("200.00")
    expect((await retenciones())[0]).toMatchObject({ costoPropuesto: null, estado: "pendiente" })
  })

  it("un retenido cuyo costo vuelve dentro del umbral se resuelve solo", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "150")
    await aplicar(T, ["1"], "costo")
    await setCosto("1", "104")
    await aplicar(T, ["1"], "costo")
    expect((await retenciones())[0].estado).toBe("resuelta")
    expect((await fila("1")).precioOnlineRef).toBe("208.00")
  })

  it("un retenido cuyo costo vuelve exactamente al vigente se resuelve solo", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "150")
    await aplicar(T, ["1"], "costo")
    await setCosto("1", "100")
    await aplicar(T, ["1"], "costo")
    expect((await retenciones())[0].estado).toBe("resuelta")
  })

  it("un nuevo costo sobre un retenido actualiza la misma fila pendiente", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "150")
    await aplicar(T, ["1"], "costo")
    await setCosto("1", "160")
    await aplicar(T, ["1"], "costo")
    const rs = await retenciones()
    expect(rs).toHaveLength(1)
    expect(rs[0].costoPropuesto).toBe("160.0000")
  })

  it("una rechazada con el mismo costo no reabre; con otro costo sí", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "150")
    await aplicar(T, ["1"], "costo")
    await getDb().update(preciosOnlineRetenciones).set({ estado: "rechazada" })
    const r = await aplicar(T, ["1"], "costo") // misma sync, mismo costo
    expect(r.retenidos).toBe(0)
    expect((await retenciones()).filter((x) => x.estado === "pendiente")).toHaveLength(0)
    await setCosto("1", "170")
    await aplicar(T, ["1"], "costo")
    expect((await retenciones()).filter((x) => x.estado === "pendiente")).toHaveLength(1)
  })

  it("el umbral es configurable y también actúa solo al superarlo", async () => {
    await getDb().insert(preciosOnlineConfig).values({ tenantId: T, umbralRetencionPct: "30" })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "2", costo: "100" })
    await aplicar(T, null, "config")
    await setCosto("1", "130")
    await setCosto("2", "131")
    const r = await aplicar(T, null, "costo")
    expect(r.retenidos).toBe(1)
    expect((await retenciones())[0].alegraId).toBe("2")
  })

  it("aísla por tenant", async () => {
    await seedLista(OTRO, "Lista A", "2", { esReferencia: true })
    await seedProducto(OTRO, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await aplicar(OTRO, null, "config")
    await getDb().update(catalogProducts).set({ costo: "500" })
    await aplicar(T, null, "costo")
    const filas = await getDb().select().from(catalogProducts).orderBy(sql`tenant_id`)
    const por = Object.fromEntries(filas.map((f) => [f.tenantId, f]))
    expect(por[T].precioOnlineRef).toBe("200.00") // retenido
    expect(por[OTRO].costoAplicado).toBe("100.0000") // no se tocó
  })
})
