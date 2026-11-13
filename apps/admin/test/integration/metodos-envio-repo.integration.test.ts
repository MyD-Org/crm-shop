import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { crearMetodo, eliminarMetodo, guardarMetodo, leerMetodosActivos, listarMetodos } from "@/lib/metodos-envio-repo"
import { validarMetodoEnvio, type MetodoEnvioValidado } from "@/lib/metodos-envio-validacion"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Repo de métodos de envío por zona contra la base real de test (migración 0101). Datos inventados:
 * tenants `tenant-a` / `tenant-b`, coordenadas sintéticas.
 */

const A = "tenant-a"
const B = "tenant-b"

const cuadrado = (w: number, s: number, e: number, n: number) => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]

function metodo(extra: Record<string, unknown> = {}): MetodoEnvioValidado {
  const r = validarMetodoEnvio({
    slug: "envio-en-el-dia",
    nombre: "Envío en el día",
    activo: true,
    provincia: "Buenos Aires",
    sucursalOrigen: "mdp",
    diasOperativos: [1, 2, 3, 4, 5],
    horaCorte: "09:00",
    margenMin: 15,
    promesa: "Entrega en el día",
    gratisAplica: false,
    itemAlegraId: "9001",
    itemAlegraIva: 21,
    zonas: [
      { nombre: "Centro", precio: 3000, orden: 1, geometria: cuadrado(-57.6, -38.05, -57.5, -37.95), entradas: [{ tipo: "cp", valor: "7600" }] },
      { nombre: "Costa", precio: 4500, orden: 2, geometria: cuadrado(-57.5, -38.05, -57.4, -37.95), entradas: [] },
    ],
    localidades: [{ georefId: "9990001", etiqueta: "Ciudad Ejemplo — Buenos Aires", abreviaturas: ["ce"] }],
    ...extra,
  })
  if (!r.ok) throw new Error(r.error)
  return r.metodo
}

const CENTRO = { centro: { lat: -38, lon: -57.5 }, bbox: { sur: -38.1, norte: -37.9, oeste: -57.7, este: -57.3 } }
const conGeo = (m: MetodoEnvioValidado, geo = CENTRO) => ({ ...m, localidades: m.localidades.map((l) => ({ ...l, ...geo })) })

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})

afterAll(async () => {
  await truncateAll()
})

describe("crear y listar", () => {
  it("guarda método, zonas, geometrías, entradas y localidades y los devuelve completos", async () => {
    const r = await crearMetodo(A, conGeo(metodo()))
    expect(r.kind).toBe("ok")
    const [m] = await listarMetodos(A)
    expect(m).toMatchObject({
      slug: "envio-en-el-dia",
      activo: true,
      provincia: "Buenos Aires",
      provinciaClave: "buenosaires",
      sucursalOrigen: "mdp",
      diasOperativos: [1, 2, 3, 4, 5],
      horaCorte: "09:00",
      margenMin: 15,
      itemAlegraId: "9001",
      itemAlegraIva: 21,
    })
    expect(m.zonas.map((z) => [z.nombre, z.precio])).toEqual([["Centro", 3000], ["Costa", 4500]])
    expect(m.zonas[0].geometria).toEqual(cuadrado(-57.6, -38.05, -57.5, -37.95))
    expect(m.zonas[0].entradas).toEqual([{ tipo: "cp", valor: "7600", etiqueta: "CP 7600" }])
    expect(m.localidades[0]).toMatchObject({ georefId: "9990001", abreviaturas: ["ce"], centro: CENTRO.centro, bbox: CENTRO.bbox })
  })

  it("slug repetido en el mismo tenant es un conflicto; en otro tenant no", async () => {
    await crearMetodo(A, metodo())
    const dup = await crearMetodo(A, metodo())
    expect(dup).toMatchObject({ kind: "conflict", campo: "slug" })
    expect((await crearMetodo(B, metodo())).kind).toBe("ok")
  })

  it("aísla por tenant", async () => {
    await crearMetodo(A, metodo())
    expect(await listarMetodos(B)).toEqual([])
  })
})

describe("guardar (reemplazo completo en una transacción)", () => {
  it("conserva el id de las zonas que vuelven con id, reemplaza el resto y sus entradas", async () => {
    await crearMetodo(A, metodo())
    const [antes] = await listarMetodos(A)
    const centro = antes.zonas.find((z) => z.nombre === "Centro")!
    const nuevo = metodo({
      nombre: "Envío rápido",
      zonas: [
        { id: centro.id, nombre: "Centro", precio: 3500, orden: 1, geometria: cuadrado(-57.6, -38.05, -57.5, -37.95), entradas: [{ tipo: "cp", valor: "7601" }] },
        { nombre: "Norte", precio: 5000, orden: 3, geometria: cuadrado(-57.6, -37.95, -57.5, -37.85), entradas: [] },
      ],
      localidades: [],
    })
    const r = await guardarMetodo(A, antes.id, nuevo)
    expect(r.kind).toBe("ok")
    const [despues] = await listarMetodos(A)
    expect(despues.nombre).toBe("Envío rápido")
    expect(despues.zonas.map((z) => z.nombre)).toEqual(["Centro", "Norte"])
    expect(despues.zonas[0].id).toBe(centro.id)
    expect(despues.zonas[0].precio).toBe(3500)
    expect(despues.zonas[0].entradas).toEqual([{ tipo: "cp", valor: "7601", etiqueta: "CP 7601" }])
    expect(despues.localidades).toEqual([])
    const huerfanas = await getDb().execute(sql`select count(*)::int as n from metodos_envio_zona_entradas where metodo_id = ${antes.id}`)
    expect((huerfanas[0] as { n: number }).n).toBe(1)
  })

  it("si una localidad ya tenía centro y rectángulo y el nuevo guardado no los consigue, los conserva", async () => {
    await crearMetodo(A, conGeo(metodo()))
    const [antes] = await listarMetodos(A)
    await guardarMetodo(A, antes.id, conGeo(metodo(), { centro: null as never, bbox: null as never }))
    const [despues] = await listarMetodos(A)
    expect(despues.localidades[0]).toMatchObject({ centro: CENTRO.centro, bbox: CENTRO.bbox })
  })

  it("una falla a mitad de camino no deja el método a medias", async () => {
    await crearMetodo(A, metodo())
    const [antes] = await listarMetodos(A)
    const roto = metodo()
    // Dos zonas con el mismo nombre: la validación lo evita, la base (UNIQUE) lo frena igual.
    roto.zonas = [roto.zonas[0], { ...roto.zonas[1], nombre: roto.zonas[0].nombre }]
    await expect(guardarMetodo(A, antes.id, roto)).rejects.toThrow()
    const [despues] = await listarMetodos(A)
    expect(despues.zonas.map((z) => z.nombre)).toEqual(["Centro", "Costa"])
  })

  it("método de otro tenant o inexistente: not_found", async () => {
    await crearMetodo(A, metodo())
    const [deA] = await listarMetodos(A)
    expect((await guardarMetodo(B, deA.id, metodo())).kind).toBe("not_found")
    expect((await guardarMetodo(A, "0b9f3a52-6f1c-4f5e-9d2a-1c2d3e4f5a6b", metodo())).kind).toBe("not_found")
  })

  it("renombrar a un slug ocupado es un conflicto", async () => {
    await crearMetodo(A, metodo())
    await crearMetodo(A, metodo({ slug: "otro", nombre: "Otro" }))
    const otro = (await listarMetodos(A)).find((m) => m.slug === "otro")!
    expect(await guardarMetodo(A, otro.id, metodo())).toMatchObject({ kind: "conflict", campo: "slug" })
  })
})

describe("eliminar", () => {
  it("sólo si está inactivo", async () => {
    await crearMetodo(A, metodo())
    const [m] = await listarMetodos(A)
    expect(await eliminarMetodo(A, m.id)).toMatchObject({ kind: "conflict" })
    await guardarMetodo(A, m.id, metodo({ activo: false }))
    expect((await eliminarMetodo(A, m.id)).kind).toBe("ok")
    expect(await listarMetodos(A)).toEqual([])
  })
  it("de otro tenant: not_found", async () => {
    await crearMetodo(A, metodo({ activo: false }))
    const [m] = await listarMetodos(A)
    expect((await eliminarMetodo(B, m.id)).kind).toBe("not_found")
  })
})

describe("leerMetodosActivos (lo que usa la prueba de dirección)", () => {
  it("sólo activos, con la forma que consumen los módulos puros", async () => {
    await crearMetodo(A, metodo())
    await crearMetodo(A, metodo({ slug: "apagado", nombre: "Apagado", activo: false }))
    const activos = await leerMetodosActivos(A)
    expect(activos.map((m) => m.slug)).toEqual(["envio-en-el-dia"])
    expect(activos[0].zonas[0]).toMatchObject({ nombre: "Centro", precio: 3000, activa: true })
    expect(activos[0].zonas[0].entradas[0]).toMatchObject({ tipo: "cp", valor: "7600" })
  })
})
