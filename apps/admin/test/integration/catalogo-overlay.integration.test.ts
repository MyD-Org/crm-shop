import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogOverlay, catalogOverlayTags, catalogProducts, shopCategories, shopTags } from "@/db/schema"
import {
  actualizarCategoria,
  asignarTagsProducto,
  borrarCategoria,
  borrarTag,
  contarSeleccion,
  crearCategoria,
  crearTag,
  guardarOverlay,
  impactoBorrarCategoria,
  impactoBorrarTag,
  listarTags,
  masivaOverlay,
  masivaTags,
  renombrarTag,
  reordenarNivel,
  tagsDeProducto,
  type Seleccion,
} from "@/lib/catalogo-overlay-repo"
import { seedTenant, truncateAll } from "./helpers"

// Repositorio del catálogo comercial (L3). DB real (crm_test).
//
// Lo que estos tests protegen, en orden de gravedad:
//   1. `updated_at` avanza en TODA escritura del overlay, incluidas las que sólo tocan la tabla
//      de relación de tags. Un olvido acá es un producto cuyo cambio NUNCA llega al Shop.
//   2. El orden de las transacciones de borrado (categoría y tag): bumpear ANTES del DELETE.
//      Después del DELETE los productos afectados son imposibles de encontrar.
//   3. Renombrar un tag NO mueve ninguna fila de producto: es el punto entero de que los tags
//      tengan entidad propia. Si esto falla, cada rename infla el delta.

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const PRECIO = [{ idPriceList: "1", name: "General", price: 1500 }]

async function seedProducto(tenantId: string, alegraId: string, extra: Partial<typeof catalogProducts.$inferInsert> = {}) {
  await getDb()
    .insert(catalogProducts)
    .values({
      tenantId,
      alegraId,
      name: `COD-${alegraId}`,
      description: `Producto ${alegraId}`,
      prices: PRECIO,
      status: "active",
      ...extra,
    })
}

const updatedAtDe = async (tenantId: string, alegraId: string): Promise<Date> => {
  const [row] = await getDb()
    .select({ updatedAt: catalogOverlay.updatedAt })
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, tenantId), eq(catalogOverlay.alegraId, alegraId)))
  return row.updatedAt
}

/** Retrasa el updated_at para que cualquier escritura posterior sea detectable. */
async function envejecer(tenantId: string, alegraIds?: string[]): Promise<void> {
  const db = getDb()
  await db
    .update(catalogOverlay)
    .set({ updatedAt: sql`now() - interval '1 hour'` })
    .where(
      alegraIds
        ? and(eq(catalogOverlay.tenantId, tenantId), sql`${catalogOverlay.alegraId} = ANY(${alegraIds})`)
        : eq(catalogOverlay.tenantId, tenantId),
    )
}

const hace1h = (d: Date) => Date.now() - d.getTime() > 30 * 60 * 1000

beforeEach(async () => {
  await truncateAll()
  await getDb().execute(sql`truncate table catalog_products, catalog_overlay, shop_categories, shop_tags restart identity cascade`)
  await seedTenant(TENANT_A)
  await seedTenant(TENANT_B)
})

afterAll(async () => {
  await truncateAll()
})

describe("categorías — jerarquía", () => {
  const crear = async (nombre: string, parentId: string | null = null) => {
    const r = await crearCategoria(TENANT_A, { nombre, parentId })
    if (r.kind !== "ok") throw new Error(`no se creó ${nombre}: ${JSON.stringify(r)}`)
    return r.row
  }

  it("crea una raíz con nivel 1 y slug derivado", async () => {
    const cat = await crear("Iluminación LED")
    expect(cat.nivel).toBe(1)
    expect(cat.slug).toBe("iluminacion-led")
  })

  it("rechaza un cuarto nivel", async () => {
    const a = await crear("A")
    const b = await crear("B", a.id)
    const c = await crear("C", b.id)
    const r = await crearCategoria(TENANT_A, { nombre: "D", parentId: c.id })
    expect(r.kind).toBe("invalid")
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(shopCategories)
    expect(n).toBe(3) // no se creó ninguna
  })

  it("rechaza un ciclo y deja la jerarquía como estaba", async () => {
    const a = await crear("A")
    const b = await crear("B", a.id)
    const r = await actualizarCategoria(TENANT_A, a.id, { parentId: b.id })
    expect(r.kind).toBe("invalid")
    const [fresca] = await getDb().select().from(shopCategories).where(eq(shopCategories.id, a.id))
    expect(fresca.parentId).toBe(null)
  })

  it("rechaza mover una rama que excede el límite ANTES de escribir nada", async () => {
    const a = await crear("A")
    const b = await crear("B", a.id)
    await crear("C", b.id)
    const z = await crear("Z")
    const r = await actualizarCategoria(TENANT_A, a.id, { parentId: z.id })
    expect(r.kind).toBe("invalid")
    const [fresca] = await getDb().select().from(shopCategories).where(eq(shopCategories.id, a.id))
    expect(fresca.parentId).toBe(null)
  })

  it("rechaza un slug duplicado entre hermanas y acepta el mismo bajo padres distintos", async () => {
    const electricidad = await crear("Electricidad")
    const redes = await crear("Redes")
    await crear("Cables", electricidad.id)

    const dup = await crearCategoria(TENANT_A, { nombre: "Cables", parentId: electricidad.id })
    expect(dup.kind).toBe("duplicado")

    const ok = await crearCategoria(TENANT_A, { nombre: "Cables", parentId: redes.id })
    expect(ok.kind).toBe("ok")
  })

  it("rechaza dos raíces con el mismo slug (índice parcial, NULL <> NULL)", async () => {
    await crear("Electricidad")
    const dup = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
    expect(dup.kind).toBe("duplicado")
  })

  it("no acepta como padre una categoría de otro tenant", async () => {
    const ajena = await crearCategoria(TENANT_B, { nombre: "Ajena" })
    if (ajena.kind !== "ok") throw new Error("seed")
    const r = await crearCategoria(TENANT_A, { nombre: "Propia", parentId: ajena.row.id })
    expect(r.kind).toBe("invalid")
  })

  it("reordena un nivel completo en una sola operación", async () => {
    const [a, b, c] = [await crear("A"), await crear("B"), await crear("C")]
    const r = await reordenarNivel(TENANT_A, null, [a.id, c.id, b.id])
    expect(r.kind).toBe("ok")
    const rows = await getDb().select().from(shopCategories).orderBy(shopCategories.orden)
    expect(rows.map((x) => x.nombre)).toEqual(["A", "C", "B"])
  })

  it("rechaza entero un reordenamiento parcial o con repetidos", async () => {
    const [a, b] = [await crear("A"), await crear("B")]
    expect((await reordenarNivel(TENANT_A, null, [a.id])).kind).toBe("conjunto_invalido")
    expect((await reordenarNivel(TENANT_A, null, [a.id, a.id])).kind).toBe("conjunto_invalido")
    const rows = await getDb().select().from(shopCategories).orderBy(shopCategories.orden)
    expect(rows.map((x) => x.id)).toEqual([a.id, b.id])
  })
})

describe("borrar una categoría", () => {
  it("arrastra sus productos al delta y los deja en 'Sin clasificar' sin despublicarlos", async () => {
    const cat = await crearCategoria(TENANT_A, { nombre: "Cables" })
    if (cat.kind !== "ok") throw new Error("seed")
    await seedProducto(TENANT_A, "1")
    await guardarOverlay(TENANT_A, "1", { visible: true, nombre: "Cable 2.5", categoriaId: cat.row.id })
    await envejecer(TENANT_A)
    const antes = await updatedAtDe(TENANT_A, "1")

    const impacto = await impactoBorrarCategoria(TENANT_A, cat.row.id)
    expect(impacto).toEqual({ productos: 1, hijas: 0 })

    const r = await borrarCategoria(TENANT_A, cat.row.id)
    expect(r.kind).toBe("ok")

    const [row] = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.alegraId, "1"))
    expect(row.categoriaId).toBe(null)
    expect(row.visible).toBe(true) // borrar una categoría NO despublica
    expect(row.nombre).toBe("Cable 2.5")
    // El arrastre: sin el UPDATE previo al DELETE, esto no avanza y el Shop nunca se entera.
    expect(row.updatedAt.getTime()).toBeGreaterThan(antes.getTime())
    expect(hace1h(row.updatedAt)).toBe(false)
  })

  it("rechaza borrar una categoría con hijas", async () => {
    const padre = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
    if (padre.kind !== "ok") throw new Error("seed")
    await crearCategoria(TENANT_A, { nombre: "Cables", parentId: padre.row.id })
    expect((await borrarCategoria(TENANT_A, padre.row.id)).kind).toBe("con_hijas")
  })

  it("no encuentra una categoría de otro tenant", async () => {
    const ajena = await crearCategoria(TENANT_B, { nombre: "Ajena" })
    if (ajena.kind !== "ok") throw new Error("seed")
    expect((await borrarCategoria(TENANT_A, ajena.row.id)).kind).toBe("not_found")
    const [sigue] = await getDb().select().from(shopCategories).where(eq(shopCategories.id, ajena.row.id))
    expect(sigue).toBeTruthy()
  })
})

describe("updated_at avanza en TODA escritura del overlay", () => {
  it("guardar campos, masiva, asignar tags, masiva de tags y borrar un tag", async () => {
    await seedProducto(TENANT_A, "1")
    await guardarOverlay(TENANT_A, "1", { visible: false })

    // (a) PATCH por producto
    await envejecer(TENANT_A)
    await guardarOverlay(TENANT_A, "1", { nombre: "Térmica bipolar 16A" })
    expect(hace1h(await updatedAtDe(TENANT_A, "1"))).toBe(false)

    // (b) masiva
    await envejecer(TENANT_A)
    await masivaOverlay(TENANT_A, { tipo: "ids", alegraIds: ["1"] }, { tipo: "visible", valor: true })
    expect(hace1h(await updatedAtDe(TENANT_A, "1"))).toBe(false)

    const tag = await crearTag(TENANT_A, { nombre: "Oferta" })
    if (tag.kind !== "ok") throw new Error("seed")

    // (c) asignar tags a un producto (escribe en OTRA tabla: la regla no lo cubre sola)
    await envejecer(TENANT_A)
    await asignarTagsProducto(TENANT_A, "1", [tag.row.id])
    expect(hace1h(await updatedAtDe(TENANT_A, "1"))).toBe(false)

    // (d) quitar el tag
    await envejecer(TENANT_A)
    await asignarTagsProducto(TENANT_A, "1", [])
    expect(hace1h(await updatedAtDe(TENANT_A, "1"))).toBe(false)

    // (e) masiva de tags
    await envejecer(TENANT_A)
    await masivaTags(TENANT_A, { tipo: "ids", alegraIds: ["1"] }, tag.row.id, "agregar")
    expect(hace1h(await updatedAtDe(TENANT_A, "1"))).toBe(false)

    // (f) borrar el tag
    await envejecer(TENANT_A)
    await borrarTag(TENANT_A, tag.row.id)
    expect(hace1h(await updatedAtDe(TENANT_A, "1"))).toBe(false)
  })

  it("guardar sólo el nombre no toca categoría, visibilidad ni fotos", async () => {
    const cat = await crearCategoria(TENANT_A, { nombre: "Cables" })
    if (cat.kind !== "ok") throw new Error("seed")
    await seedProducto(TENANT_A, "1")
    await guardarOverlay(TENANT_A, "1", {
      visible: true,
      categoriaId: cat.row.id,
      fotos: [{ url: "https://fotos.example/a-800.webp", w: 800 }],
    })
    await envejecer(TENANT_A)

    await guardarOverlay(TENANT_A, "1", { nombre: "Cable 2.5" })

    const [row] = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.alegraId, "1"))
    expect(row.nombre).toBe("Cable 2.5")
    expect(row.visible).toBe(true)
    expect(row.categoriaId).toBe(cat.row.id)
    expect(row.fotos).toHaveLength(1)
    expect(hace1h(row.updatedAt)).toBe(false)
  })

  it("ningún producto NO seleccionado cambia su marca", async () => {
    await seedProducto(TENANT_A, "1")
    await seedProducto(TENANT_A, "2")
    await guardarOverlay(TENANT_A, "1", { visible: false })
    await guardarOverlay(TENANT_A, "2", { visible: false })
    await envejecer(TENANT_A)

    await masivaOverlay(TENANT_A, { tipo: "ids", alegraIds: ["1"] }, { tipo: "visible", valor: true })

    expect(hace1h(await updatedAtDe(TENANT_A, "1"))).toBe(false)
    expect(hace1h(await updatedAtDe(TENANT_A, "2"))).toBe(true)
  })
})

describe("acciones masivas por descriptor", () => {
  beforeEach(async () => {
    // 5 productos sin overlay + 1 con overlay y con foto.
    for (const id of ["1", "2", "3", "4", "5"]) await seedProducto(TENANT_A, id)
    await seedProducto(TENANT_A, "6")
    await guardarOverlay(TENANT_A, "6", { fotos: [{ url: "https://fotos.example/x-800.webp", w: 800 }] })
    await seedProducto(TENANT_B, "1") // de otro tenant: nunca se toca
  })

  it("crea las filas de overlay que faltan sobre productos sin curar", async () => {
    const seleccion: Seleccion = { tipo: "filtro", filtros: { foto: "sin" } }
    expect(await contarSeleccion(TENANT_A, seleccion)).toBe(5)

    const r = await masivaOverlay(TENANT_A, seleccion, { tipo: "visible", valor: true })
    expect(r).toEqual({ kind: "ok", afectados: 5 })

    const rows = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.tenantId, TENANT_A))
    expect(rows).toHaveLength(6)
    expect(rows.filter((r) => r.visible)).toHaveLength(5)
  })

  it("respeta las exclusiones del descriptor", async () => {
    const r = await masivaOverlay(
      TENANT_A,
      { tipo: "filtro", filtros: { foto: "sin" }, excluir: ["4", "5"] },
      { tipo: "visible", valor: true },
    )
    expect(r).toEqual({ kind: "ok", afectados: 3 })
  })

  it("es idempotente: ocultar dos veces no es error", async () => {
    const seleccion: Seleccion = { tipo: "ids", alegraIds: ["1", "2"] }
    expect((await masivaOverlay(TENANT_A, seleccion, { tipo: "visible", valor: false })).kind).toBe("ok")
    const r = await masivaOverlay(TENANT_A, seleccion, { tipo: "visible", valor: false })
    expect(r).toEqual({ kind: "ok", afectados: 2 })
  })

  it("nunca toca productos de otro tenant, ni con el mismo alegra_id", async () => {
    await masivaOverlay(TENANT_A, { tipo: "ids", alegraIds: ["1"] }, { tipo: "visible", valor: true })
    const ajenos = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.tenantId, TENANT_B))
    expect(ajenos).toHaveLength(0)
  })

  it("asigna categoría en masa", async () => {
    const cat = await crearCategoria(TENANT_A, { nombre: "Cables" })
    if (cat.kind !== "ok") throw new Error("seed")
    const r = await masivaOverlay(
      TENANT_A,
      { tipo: "ids", alegraIds: ["1", "2", "3"] },
      { tipo: "categoria", categoriaId: cat.row.id },
    )
    expect(r).toEqual({ kind: "ok", afectados: 3 })
    const rows = await getDb()
      .select()
      .from(catalogOverlay)
      .where(and(eq(catalogOverlay.tenantId, TENANT_A), eq(catalogOverlay.categoriaId, cat.row.id)))
    expect(rows).toHaveLength(3)
  })

  it("rechaza una lista de ids por encima del tope", async () => {
    const alegraIds = Array.from({ length: 501 }, (_, i) => String(i))
    const r = await masivaOverlay(TENANT_A, { tipo: "ids", alegraIds }, { tipo: "visible", valor: true })
    expect(r.kind).toBe("invalid")
  })

  it("filtra por categoría incluyendo el subárbol", async () => {
    const padre = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
    if (padre.kind !== "ok") throw new Error("seed")
    const hija = await crearCategoria(TENANT_A, { nombre: "Cables", parentId: padre.row.id })
    if (hija.kind !== "ok") throw new Error("seed")

    await guardarOverlay(TENANT_A, "1", { categoriaId: padre.row.id })
    await guardarOverlay(TENANT_A, "2", { categoriaId: hija.row.id })
    await guardarOverlay(TENANT_A, "3", { categoriaId: null })

    expect(await contarSeleccion(TENANT_A, { tipo: "filtro", filtros: { categoria: padre.row.id } })).toBe(2)
    expect(await contarSeleccion(TENANT_A, { tipo: "filtro", filtros: { categoria: hija.row.id } })).toBe(1)
  })

  it("'sin clasificar' incluye a los productos sin fila de overlay", async () => {
    const cat = await crearCategoria(TENANT_A, { nombre: "Cables" })
    if (cat.kind !== "ok") throw new Error("seed")
    await guardarOverlay(TENANT_A, "1", { categoriaId: cat.row.id })
    // 6 productos del tenant A, uno clasificado.
    expect(await contarSeleccion(TENANT_A, { tipo: "filtro", filtros: { categoria: "sin" } })).toBe(5)
  })

  it("busca por texto sobre el nombre efectivo y sobre el código", async () => {
    await guardarOverlay(TENANT_A, "1", { nombre: "Térmica bipolar 16A" })
    expect(await contarSeleccion(TENANT_A, { tipo: "filtro", filtros: { q: "bipolar" } })).toBe(1)
    expect(await contarSeleccion(TENANT_A, { tipo: "filtro", filtros: { q: "COD-1" } })).toBe(1)
  })
})

describe("tags", () => {
  const nuevoTag = async (nombre: string, tenantId = TENANT_A) => {
    const r = await crearTag(tenantId, { nombre })
    if (r.kind !== "ok") throw new Error(`no se creó ${nombre}`)
    return r.row
  }

  it("crea un tag y lo lista con conteo 0", async () => {
    await nuevoTag("Nuevo")
    expect(await listarTags(TENANT_A)).toEqual([expect.objectContaining({ nombre: "Nuevo", slug: "nuevo", productos: 0 })])
  })

  it("rechaza el nombre duplicado, incluidas las variantes de may/min y espacios", async () => {
    await nuevoTag("Oferta")
    expect((await crearTag(TENANT_A, { nombre: "Oferta" })).kind).toBe("duplicado")
    expect((await crearTag(TENANT_A, { nombre: "  OFERTA " })).kind).toBe("duplicado")
  })

  it("el mismo nombre en tenants distintos no colisiona", async () => {
    await nuevoTag("Oferta")
    expect((await crearTag(TENANT_B, { nombre: "Oferta" })).kind).toBe("ok")
  })

  it("renombrar NO mueve ninguna fila de producto (el punto entero del modelo)", async () => {
    const tag = await nuevoTag("Oferta")
    for (const id of ["1", "2", "3"]) {
      await seedProducto(TENANT_A, id)
      await asignarTagsProducto(TENANT_A, id, [tag.id])
    }
    await envejecer(TENANT_A)
    const antes = await Promise.all(["1", "2", "3"].map((id) => updatedAtDe(TENANT_A, id)))

    const r = await renombrarTag(TENANT_A, tag.id, { nombre: "Liquidación" })
    expect(r.kind === "ok" && r.row.slug).toBe("liquidacion")

    const despues = await Promise.all(["1", "2", "3"].map((id) => updatedAtDe(TENANT_A, id)))
    expect(despues.map((d) => d.getTime())).toEqual(antes.map((d) => d.getTime()))
    // El id es estable: los productos siguen apuntando al mismo tag.
    expect((await tagsDeProducto(TENANT_A, "1"))[0].nombre).toBe("Liquidación")
  })

  it("renombrar a un nombre ya usado se rechaza y no cambia ninguno", async () => {
    const oferta = await nuevoTag("Oferta")
    await nuevoTag("Liquidación")
    expect((await renombrarTag(TENANT_A, oferta.id, { nombre: "Liquidación" })).kind).toBe("duplicado")
    const [fresco] = await getDb().select().from(shopTags).where(eq(shopTags.id, oferta.id))
    expect(fresco.nombre).toBe("Oferta")
  })

  it("borrar un tag SÍ arrastra a sus productos al delta y no los borra", async () => {
    const tag = await nuevoTag("Descontinuado")
    const otro = await nuevoTag("Oferta")
    for (const id of ["1", "2"]) {
      await seedProducto(TENANT_A, id)
      await asignarTagsProducto(TENANT_A, id, [tag.id, otro.id])
    }
    await envejecer(TENANT_A)

    expect(await impactoBorrarTag(TENANT_A, tag.id)).toBe(2)
    expect((await borrarTag(TENANT_A, tag.id)).kind).toBe("ok")

    for (const id of ["1", "2"]) {
      // Sin el UPDATE previo al DELETE, el cascade ya borró la relación y estas filas serían
      // imposibles de encontrar.
      expect(hace1h(await updatedAtDe(TENANT_A, id))).toBe(false)
      const tags = await tagsDeProducto(TENANT_A, id)
      expect(tags.map((t) => t.nombre)).toEqual(["Oferta"]) // conserva el resto de sus tags
    }
  })

  it("el conteo de productos por tag es exacto", async () => {
    const oferta = await nuevoTag("Oferta")
    await nuevoTag("Nuevo")
    for (const id of ["1", "2", "3"]) {
      await seedProducto(TENANT_A, id)
      await asignarTagsProducto(TENANT_A, id, [oferta.id])
    }
    const tags = await listarTags(TENANT_A)
    expect(tags.find((t) => t.nombre === "Oferta")?.productos).toBe(3)
    expect(tags.find((t) => t.nombre === "Nuevo")?.productos).toBe(0)
  })

  it("una asignación masiva sobre productos SIN overlay crea las filas y la relación", async () => {
    const tag = await nuevoTag("Oferta")
    for (const id of ["1", "2", "3"]) await seedProducto(TENANT_A, id)

    const r = await masivaTags(TENANT_A, { tipo: "filtro", filtros: { foto: "sin" } }, tag.id, "agregar")
    expect(r).toEqual({ kind: "ok", afectados: 3 })

    const overlays = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.tenantId, TENANT_A))
    expect(overlays).toHaveLength(3)
    expect(await listarTags(TENANT_A)).toEqual([expect.objectContaining({ productos: 3 })])
  })

  it("quitar un tag en masa lo saca sólo de los seleccionados", async () => {
    const tag = await nuevoTag("Oferta")
    for (const id of ["1", "2"]) {
      await seedProducto(TENANT_A, id)
      await asignarTagsProducto(TENANT_A, id, [tag.id])
    }
    await masivaTags(TENANT_A, { tipo: "ids", alegraIds: ["1"] }, tag.id, "quitar")
    expect(await tagsDeProducto(TENANT_A, "1")).toHaveLength(0)
    expect(await tagsDeProducto(TENANT_A, "2")).toHaveLength(1)
  })

  it("no asigna un tag de otro tenant", async () => {
    const ajeno = await nuevoTag("Ajeno", TENANT_B)
    await seedProducto(TENANT_A, "1")
    const r = await asignarTagsProducto(TENANT_A, "1", [ajeno.id])
    expect(r.tagIds).toEqual([])
    expect(await tagsDeProducto(TENANT_A, "1")).toHaveLength(0)
    expect((await masivaTags(TENANT_A, { tipo: "ids", alegraIds: ["1"] }, ajeno.id, "agregar")).kind).toBe("invalid")
  })

  it("no encuentra ni borra un tag de otro tenant", async () => {
    const ajeno = await nuevoTag("Ajeno", TENANT_B)
    expect((await borrarTag(TENANT_A, ajeno.id)).kind).toBe("not_found")
    expect((await renombrarTag(TENANT_A, ajeno.id, { nombre: "Mío" })).kind).toBe("not_found")
    expect(await impactoBorrarTag(TENANT_A, ajeno.id)).toBe(null)
  })

  it("borrar una categoría NO toca los tags de sus productos", async () => {
    const cat = await crearCategoria(TENANT_A, { nombre: "Cables" })
    if (cat.kind !== "ok") throw new Error("seed")
    const tag = await nuevoTag("Oferta")
    await seedProducto(TENANT_A, "1")
    await guardarOverlay(TENANT_A, "1", { categoriaId: cat.row.id })
    await asignarTagsProducto(TENANT_A, "1", [tag.id])

    await borrarCategoria(TENANT_A, cat.row.id)

    expect((await tagsDeProducto(TENANT_A, "1")).map((t) => t.nombre)).toEqual(["Oferta"])
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(catalogOverlayTags)
    expect(n).toBe(1)
  })

  it("filtra productos por tag", async () => {
    const tag = await nuevoTag("Oferta")
    for (const id of ["1", "2", "3"]) await seedProducto(TENANT_A, id)
    await asignarTagsProducto(TENANT_A, "1", [tag.id])
    expect(await contarSeleccion(TENANT_A, { tipo: "filtro", filtros: { tag: tag.id } })).toBe(1)
  })
})
