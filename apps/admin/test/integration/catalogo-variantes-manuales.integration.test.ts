import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { quitarDelGrupo, recalcularGrupos, sumarAGrupo } from "@/lib/catalogo-variantes-repo"
import { seedTenant, truncateAll } from "./helpers"

// Grupos armados a mano (change `variantes-de-producto`, S4, migración 0082): sumar un producto
// suelto a un modelo, quitarlo, y las reglas que evitan ciclos y doble pertenencia. DB real
// (crm_test). Datos inventados.

const T = "tenant-man"
const OTRO = "tenant-otro"

interface Fila {
  id: string
  tipo?: "simple" | "padre" | "variante"
  padre?: string | null
  opcion?: string | null
  stock?: number | null
  precio?: number | null
  tenant?: string
}

async function sembrar(f: Fila) {
  const online = f.precio ? JSON.stringify([{ idPriceList: "lista-1", name: "Online", price: f.precio, main: true }]) : "[]"
  const variante = f.opcion ? JSON.stringify([{ atributo: "Color", opcion: f.opcion }]) : null
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, padre_alegra_id, variante, stock, status, alegra_status, precios_online)
    VALUES (${f.tenant ?? T}, ${f.id}, ${"Producto " + f.id}, ${f.tipo ?? "simple"}, ${f.padre ?? null}, ${variante}::jsonb,
            ${f.stock ?? null}, 'active', 'active', ${online}::jsonb)
  `)
}

async function leer(id: string, tenant = T) {
  const rows = (await getDb().execute(
    sql`SELECT grupo_id, etiqueta, es_representante FROM catalog_products WHERE tenant_id = ${tenant} AND alegra_id = ${id}`,
  )) as unknown as { grupo_id: string | null; etiqueta: string | null; es_representante: boolean }[]
  return rows[0]
}

const filasManuales = async (tenant = T) =>
  (await getDb().execute(
    sql`SELECT alegra_id, grupo_id, etiqueta, orden FROM catalog_variantes_manuales WHERE tenant_id = ${tenant} ORDER BY alegra_id`,
  )) as unknown as { alegra_id: string; grupo_id: string; etiqueta: string; orden: number }[]

/** El modelo "P" (padre) con Verde y Rojo, y un RGB suelto de otro precio. */
async function modeloConRgbSuelto(rgb: Omit<Fila, "id" | "tipo"> = { precio: 180, stock: 4 }) {
  await sembrar({ id: "P", tipo: "padre" })
  await sembrar({ id: "verde", tipo: "variante", padre: "P", opcion: "Verde", precio: 100, stock: 3 })
  await sembrar({ id: "rojo", tipo: "variante", padre: "P", opcion: "Rojo", precio: 100, stock: 3 })
  await sembrar({ id: "rgb", ...rgb })
  await recalcularGrupos(T)
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})

afterAll(async () => {
  await truncateAll()
})

describe("sumarAGrupo: un producto suelto entra al modelo de un padre", () => {
  it("el RGB queda en el grupo del padre, con la etiqueta que se le puso, y conserva su precio y stock", async () => {
    await modeloConRgbSuelto()
    expect(await leer("rgb")).toMatchObject({ grupo_id: null, es_representante: true })

    const r = await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "RGB", orden: 10 }, "u1")
    expect(r.kind).toBe("ok")

    expect(await leer("rgb")).toMatchObject({ grupo_id: "P", etiqueta: "RGB", es_representante: false })
    // El modelo conserva UN representante (la variante vendible, con stock y más barata).
    const reps = (await getDb().execute(
      sql`SELECT alegra_id FROM catalog_products WHERE tenant_id = ${T} AND grupo_id = 'P' AND es_representante`,
    )) as unknown as unknown[]
    expect(reps).toHaveLength(1)
    expect(await filasManuales()).toEqual([{ alegra_id: "rgb", grupo_id: "P", etiqueta: "RGB", orden: 10 }])
  })

  it("quitarlo lo devuelve a ser una card propia y recalcula el representante de los dos grupos", async () => {
    // Verde y Rojo sin stock: el RGB (con stock) gana el modelo mientras está dentro.
    await sembrar({ id: "P", tipo: "padre" })
    await sembrar({ id: "verde", tipo: "variante", padre: "P", opcion: "Verde", precio: 100, stock: 0 })
    await sembrar({ id: "rojo", tipo: "variante", padre: "P", opcion: "Rojo", precio: 100, stock: 0 })
    await sembrar({ id: "rgb", precio: 180, stock: 5 })
    await recalcularGrupos(T)

    await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }, null)
    expect((await leer("rgb")).es_representante).toBe(true)
    expect((await leer("verde")).es_representante).toBe(false)

    const q = await quitarDelGrupo(T, "rgb")
    expect(q.kind).toBe("ok")
    expect(await leer("rgb")).toMatchObject({ grupo_id: null, etiqueta: null, es_representante: true })
    // El grupo viejo vuelve a tener su propio representante (la más barata sin stock: empate -> alegra_id).
    const reps = (await getDb().execute(
      sql`SELECT alegra_id FROM catalog_products WHERE tenant_id = ${T} AND grupo_id = 'P' AND es_representante`,
    )) as unknown as { alegra_id: string }[]
    expect(reps.map((r) => r.alegra_id)).toEqual(["rojo"])
    expect(await filasManuales()).toEqual([])
  })

  it("a igual stock y precio gana el de menor orden manual", async () => {
    await sembrar({ id: "P", tipo: "padre" })
    await sembrar({ id: "a", precio: 100, stock: 1 })
    await sembrar({ id: "b", precio: 100, stock: 1 })
    await sumarAGrupo(T, { alegraId: "b", grupoId: "P", etiqueta: "Segundo", orden: 5 }, null)
    await sumarAGrupo(T, { alegraId: "a", grupoId: "P", etiqueta: "Primero", orden: 1 }, null)
    expect((await leer("a")).es_representante).toBe(true)
    expect((await leer("b")).es_representante).toBe(false)
  })

  it("rechaza una etiqueta repetida en el modelo (de Alegra o manual) sin distinguir mayúsculas", async () => {
    await modeloConRgbSuelto()
    const r = await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: " verde " }, null)
    expect(r).toMatchObject({ kind: "invalid", campo: "etiqueta" })
    expect(await filasManuales()).toEqual([])
  })

  it("exige una etiqueta y respeta el tope de largo y de orden", async () => {
    await modeloConRgbSuelto()
    expect(await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "   " }, null)).toMatchObject({ kind: "invalid", campo: "etiqueta" })
    expect(await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "x".repeat(61) }, null)).toMatchObject({ kind: "invalid", campo: "etiqueta" })
    expect(await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "RGB", orden: -1 }, null)).toMatchObject({ kind: "invalid", campo: "orden" })
    expect(await filasManuales()).toEqual([])
  })
})

describe("sumarAGrupo: reglas de pertenencia", () => {
  it("un padre no se puede sumar a un grupo", async () => {
    await modeloConRgbSuelto()
    await sembrar({ id: "Q", tipo: "padre" })
    const r = await sumarAGrupo(T, { alegraId: "Q", grupoId: "P", etiqueta: "Otro modelo" }, null)
    expect(r).toMatchObject({ kind: "invalid", campo: "alegraId" })
  })

  it("una variante de Alegra no se puede sumar a otro grupo", async () => {
    await modeloConRgbSuelto()
    await sembrar({ id: "Q", tipo: "padre" })
    const r = await sumarAGrupo(T, { alegraId: "verde", grupoId: "Q", etiqueta: "Verde" }, null)
    expect(r).toMatchObject({ kind: "invalid", campo: "alegraId" })
    expect((await leer("verde")).grupo_id).toBe("P")
  })

  it("pertenencia única: ya sumado a un grupo no se puede sumar a otro hasta quitarlo", async () => {
    await modeloConRgbSuelto()
    await sembrar({ id: "Q", tipo: "padre" })
    await sembrar({ id: "q1", tipo: "variante", padre: "Q", opcion: "Azul", precio: 90, stock: 1 })
    await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }, null)

    const r = await sumarAGrupo(T, { alegraId: "rgb", grupoId: "Q", etiqueta: "RGB" }, null)
    expect(r).toMatchObject({ kind: "invalid", campo: "alegraId" })
    expect((await leer("rgb")).grupo_id).toBe("P")

    await quitarDelGrupo(T, "rgb")
    expect((await sumarAGrupo(T, { alegraId: "rgb", grupoId: "Q", etiqueta: "RGB" }, null)).kind).toBe("ok")
    expect((await leer("rgb")).grupo_id).toBe("Q")
  })

  it("un producto no se puede sumar a sí mismo", async () => {
    await modeloConRgbSuelto()
    expect(await sumarAGrupo(T, { alegraId: "rgb", grupoId: "rgb", etiqueta: "RGB" }, null)).toMatchObject({ kind: "invalid", campo: "grupoId" })
  })

  it("el destino no puede ser una variante ni un producto que ya está dentro de otro grupo", async () => {
    await modeloConRgbSuelto()
    await sembrar({ id: "otro", precio: 50, stock: 1 })
    await sembrar({ id: "tercero", precio: 60, stock: 1 })
    await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }, null)

    expect(await sumarAGrupo(T, { alegraId: "otro", grupoId: "verde", etiqueta: "X" }, null)).toMatchObject({ kind: "invalid", campo: "grupoId" })
    // "rgb" es miembro del grupo P: no puede ser la base de otro grupo.
    expect(await sumarAGrupo(T, { alegraId: "otro", grupoId: "rgb", etiqueta: "X" }, null)).toMatchObject({ kind: "invalid", campo: "grupoId" })
    expect(await sumarAGrupo(T, { alegraId: "tercero", grupoId: "rgb", etiqueta: "X" }, null)).toMatchObject({ kind: "invalid", campo: "grupoId" })
    expect((await filasManuales()).map((f) => f.alegra_id)).toEqual(["rgb"])
  })

  it("no hay ciclos: la base de un grupo manual no se puede sumar a otro grupo", async () => {
    await sembrar({ id: "A", precio: 100, stock: 1 })
    await sembrar({ id: "B", precio: 110, stock: 1 })
    await sembrar({ id: "Q", tipo: "padre" })
    await sumarAGrupo(T, { alegraId: "B", grupoId: "A", etiqueta: "Negro", etiquetaAncla: "Blanco" }, null)

    expect(await sumarAGrupo(T, { alegraId: "A", grupoId: "Q", etiqueta: "Blanco" }, null)).toMatchObject({ kind: "invalid", campo: "alegraId" })
    expect(await sumarAGrupo(T, { alegraId: "Q", grupoId: "A", etiqueta: "Otro" }, null)).toMatchObject({ kind: "invalid", campo: "alegraId" })
  })
})

describe("grupo manual sin padre de Alegra", () => {
  it("un producto suelto pasa a ser la base: hace falta su etiqueta y los dos quedan en el grupo", async () => {
    await sembrar({ id: "A", precio: 100, stock: 2 })
    await sembrar({ id: "B", precio: 120, stock: 2 })

    const sinEtiquetaBase = await sumarAGrupo(T, { alegraId: "B", grupoId: "A", etiqueta: "Negro" }, null)
    expect(sinEtiquetaBase).toMatchObject({ kind: "invalid", campo: "etiquetaAncla" })
    expect(await filasManuales()).toEqual([])

    const r = await sumarAGrupo(T, { alegraId: "B", grupoId: "A", etiqueta: "Negro", etiquetaAncla: "Blanco" }, "u1")
    expect(r.kind).toBe("ok")
    expect(await leer("A")).toMatchObject({ grupo_id: "A", etiqueta: "Blanco", es_representante: true })
    expect(await leer("B")).toMatchObject({ grupo_id: "A", etiqueta: "Negro", es_representante: false })
  })

  it("se puede seguir sumando a la base; al quitar el último miembro el grupo se disuelve", async () => {
    await sembrar({ id: "A", precio: 100, stock: 2 })
    await sembrar({ id: "B", precio: 120, stock: 2 })
    await sembrar({ id: "C", precio: 130, stock: 2 })
    await sumarAGrupo(T, { alegraId: "B", grupoId: "A", etiqueta: "Negro", etiquetaAncla: "Blanco" }, null)
    expect((await sumarAGrupo(T, { alegraId: "C", grupoId: "A", etiqueta: "Gris" }, null)).kind).toBe("ok")

    // La base con miembros no se puede quitar.
    expect(await quitarDelGrupo(T, "A")).toMatchObject({ kind: "invalid" })

    await quitarDelGrupo(T, "B")
    expect((await leer("A")).grupo_id).toBe("A")
    await quitarDelGrupo(T, "C")
    expect(await filasManuales()).toEqual([])
    expect(await leer("A")).toMatchObject({ grupo_id: null, etiqueta: null, es_representante: true })
    expect(await leer("C")).toMatchObject({ grupo_id: null, es_representante: true })
  })

  it("una fila manual cuyo ancla no existe no arma grupo", async () => {
    await sembrar({ id: "suelto", precio: 10, stock: 1 })
    await getDb().execute(sql`
      INSERT INTO catalog_variantes_manuales (tenant_id, alegra_id, grupo_id, etiqueta) VALUES (${T}, 'suelto', 'no-existe', 'X')
    `)
    await recalcularGrupos(T)
    expect(await leer("suelto")).toMatchObject({ grupo_id: null, etiqueta: null, es_representante: true })
  })

  it("un padre nunca entra a un grupo, aunque alguien le haya cargado una fila manual", async () => {
    await sembrar({ id: "P", tipo: "padre" })
    await sembrar({ id: "Q", tipo: "padre" })
    await getDb().execute(sql`
      INSERT INTO catalog_variantes_manuales (tenant_id, alegra_id, grupo_id, etiqueta) VALUES (${T}, 'Q', 'P', 'X')
    `)
    await recalcularGrupos(T)
    expect(await leer("Q")).toMatchObject({ grupo_id: null, es_representante: false })
  })
})

describe("migración 0082", () => {
  it("se puede reaplicar sin fallar ni tocar los datos", async () => {
    await sembrar({ id: "P", tipo: "padre" })
    await sembrar({ id: "x", precio: 10, stock: 1 })
    await sumarAGrupo(T, { alegraId: "x", grupoId: "P", etiqueta: "RGB" }, null)

    const archivo = readFileSync(path.join(process.cwd(), "drizzle", "0082_catalogo_variantes_manuales.sql"), "utf8")
    for (const sentencia of archivo.split("--> statement-breakpoint")) {
      await getDb().execute(sql.raw(sentencia))
    }
    expect(await filasManuales()).toEqual([{ alegra_id: "x", grupo_id: "P", etiqueta: "RGB", orden: 0 }])
  })

  it("no concede ningún permiso al rol del Shop", async () => {
    const filas = (await getDb().execute(sql`
      SELECT count(*)::int AS n FROM information_schema.role_table_grants
      WHERE table_name = 'catalog_variantes_manuales' AND grantee = 'shop_app'
    `)) as unknown as { n: number }[]
    expect(filas[0].n).toBe(0)
  })
})

describe("aislamiento por tenant e idempotencia", () => {
  it("un producto o un modelo de otro tenant se comporta como inexistente", async () => {
    await sembrar({ id: "P", tipo: "padre", tenant: OTRO })
    await sembrar({ id: "ajeno", tenant: OTRO, precio: 10, stock: 1 })
    await sembrar({ id: "mio", precio: 10, stock: 1 })

    expect(await sumarAGrupo(T, { alegraId: "ajeno", grupoId: "mio", etiqueta: "X", etiquetaAncla: "Y" }, null)).toMatchObject({ kind: "not_found", campo: "alegraId" })
    expect(await sumarAGrupo(T, { alegraId: "mio", grupoId: "P", etiqueta: "X" }, null)).toMatchObject({ kind: "not_found", campo: "grupoId" })
    expect(await filasManuales(T)).toEqual([])
    expect(await filasManuales(OTRO)).toEqual([])
    expect(await quitarDelGrupo(T, "ajeno")).toMatchObject({ kind: "not_found" })
  })

  it("quitar algo que no está en un grupo manual es not_found", async () => {
    await sembrar({ id: "x", precio: 10, stock: 1 })
    expect(await quitarDelGrupo(T, "x")).toMatchObject({ kind: "not_found" })
  })

  it("dos recálculos seguidos sin cambios no tocan ninguna fila", async () => {
    await modeloConRgbSuelto()
    await sumarAGrupo(T, { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }, null)
    const a = await recalcularGrupos(T)
    const b = await recalcularGrupos(T)
    expect(a.cambiados).toBe(0)
    expect(b.cambiados).toBe(0)
  })
})
