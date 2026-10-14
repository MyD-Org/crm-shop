import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { recalcularGrupos } from "@/lib/catalogo-variantes-repo"
import { FakeR2 } from "./fake-r2"
import { seedTenant, seedOperator, truncateAll } from "./helpers"

// Rutas del panel de catálogo con modelos de variantes (change `variantes-de-producto`, S4):
//  - /api/admin/catalogo/variantes (sumar a mano / quitar),
//  - las rutas de edición del producto responden 400 sobre una variante agrupada, salvo la foto propia.
// DB real, guard real, R2 falso. Datos inventados.

let session: Record<string, unknown>
const r2 = vi.hoisted(() => ({ actual: null as unknown }))
const aviso = vi.hoisted(() => ({ llamadas: 0 }))

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/aviso-shop", () => ({
  avisarShop: vi.fn(async () => {
    aviso.llamadas++
    return { propagado: true }
  }),
}))
vi.mock("@/lib/shop-media", async (orig) => ({
  ...(await orig<typeof import("@/lib/shop-media")>()),
  getShopMediaR2: () => r2.actual,
}))

const variantes = await import("@/app/api/admin/catalogo/variantes/route")
const producto = await import("@/app/api/admin/catalogo/productos/[alegraId]/route")
const fotos = await import("@/app/api/admin/catalogo/productos/[alegraId]/fotos/route")
const ficha = await import("@/app/api/admin/catalogo/productos/[alegraId]/ficha/route")
const masiva = await import("@/app/api/admin/catalogo/productos/masiva/route")

const A = "tenant-a"
const B = "tenant-b"
const UUID = "00000000-0000-4000-8000-000000000001"

const req = (method: string, body?: unknown, query = "") =>
  new NextRequest(`http://${A}.localhost/x${query}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { host: `${A}.localhost` },
  })
const params = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

async function sembrar(tenant: string, id: string, extra: { tipo?: string; padre?: string; opcion?: string } = {}) {
  const variante = extra.opcion ? JSON.stringify([{ atributo: "Color", opcion: extra.opcion }]) : null
  const precios = JSON.stringify([{ idPriceList: "1", name: "General", price: 100 }])
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, padre_alegra_id, variante, stock, status, alegra_status, prices, precios_online)
    VALUES (${tenant}, ${id}, ${"Producto " + id}, ${extra.tipo ?? "simple"}, ${extra.padre ?? null}, ${variante}::jsonb, 5, 'active', 'active', ${precios}::jsonb, ${precios}::jsonb)
  `)
}

async function loginComo(role: "admin" | "operator", tenant = A) {
  const id = await seedOperator(tenant, { role, email: `${role}-${tenant}@example.com` })
  session = { userId: id, role, tenantId: tenant, name: "Ana", email: "ana@example.com", save: async () => {} }
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  await loginComo("admin")
  aviso.llamadas = 0
  r2.actual = new FakeR2()
  await sembrar(A, "P", { tipo: "padre" })
  await sembrar(A, "v1", { tipo: "variante", padre: "P", opcion: "Verde" })
  await sembrar(A, "v2", { tipo: "variante", padre: "P", opcion: "Rojo" })
  await sembrar(A, "rgb")
  await sembrar(A, "otro")
  await sembrar(B, "ajeno")
  await sembrar(B, "PB", { tipo: "padre" })
  await recalcularGrupos(A)
  await recalcularGrupos(B)
})
afterAll(async () => {
  await truncateAll()
})

describe("POST/DELETE /api/admin/catalogo/variantes", () => {
  it("suma el RGB al modelo, avisa al Shop y devuelve el modelo con sus variantes", async () => {
    const res = await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "P", etiqueta: "RGB", orden: 5 }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.producto.alegraId).toBe("P")
    expect(json.producto.variantes.map((v: { alegraId: string }) => v.alegraId).sort()).toEqual(["rgb", "v1", "v2"])
    expect(aviso.llamadas).toBe(1)
  })

  it("quitarlo lo devuelve a ser un producto suelto", async () => {
    await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }))
    const res = await variantes.DELETE(req("DELETE", { alegraId: "rgb" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.producto.variantes.map((v: { alegraId: string }) => v.alegraId).sort()).toEqual(["v1", "v2"])
    expect(aviso.llamadas).toBe(2)
  })

  it("rechaza con mensaje en usted sumar un padre, una variante o algo que ya está en un grupo", async () => {
    const padre = await variantes.POST(req("POST", { alegraId: "P", grupoId: "otro", etiqueta: "X", etiquetaAncla: "Y" }))
    expect(padre.status).toBe(422)
    expect((await padre.json()).error).toMatch(/modelo con variantes/)

    const variante = await variantes.POST(req("POST", { alegraId: "v1", grupoId: "otro", etiqueta: "X", etiquetaAncla: "Y" }))
    expect(variante.status).toBe(422)

    await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }))
    const doble = await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "otro", etiqueta: "RGB", etiquetaAncla: "Y" }))
    expect(doble.status).toBe(422)
    expect((await doble.json()).error).toMatch(/Quítelo primero/)
    expect(aviso.llamadas).toBe(1)
  })

  it("valida el cuerpo: etiqueta obligatoria y orden numérico", async () => {
    const sinEtiqueta = await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "P" }))
    expect(sinEtiqueta.status).toBe(422)
    expect((await sinEtiqueta.json()).campo).toBe("etiqueta")
    const ordenMalo = await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "P", etiqueta: "RGB", orden: "3" }))
    expect(ordenMalo.status).toBe(422)
    const vacio = await variantes.POST(new NextRequest(`http://${A}.localhost/x`, { method: "POST", body: "no es json", headers: { host: `${A}.localhost` } }))
    expect(vacio.status).toBe(400)
  })

  it("un producto o un modelo de otro tenant es un 404", async () => {
    const producto = await variantes.POST(req("POST", { alegraId: "ajeno", grupoId: "P", etiqueta: "X" }))
    expect(producto.status).toBe(404)
    const grupo = await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "PB", etiqueta: "X" }))
    expect(grupo.status).toBe(404)
    const quitar = await variantes.DELETE(req("DELETE", { alegraId: "ajeno" }))
    expect(quitar.status).toBe(404)
    expect(aviso.llamadas).toBe(0)
  })

  it("un operador no entra (404 uniforme) y sin sesión es 401", async () => {
    await loginComo("operator")
    expect((await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }))).status).toBe(404)
    expect((await variantes.DELETE(req("DELETE", { alegraId: "rgb" }))).status).toBe(404)
    session = {}
    expect((await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "P", etiqueta: "RGB" }))).status).toBe(401)
    expect(aviso.llamadas).toBe(0)
  })
})

describe("PATCH /api/admin/catalogo/variantes (mostrar en la tienda)", () => {
  it("oculta una variante, avisa al Shop y la devuelve marcada en el modelo", async () => {
    const res = await variantes.PATCH(req("PATCH", { alegraId: "v2", ocultaEnTienda: true }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.producto.variantes.find((v: { alegraId: string }) => v.alegraId === "v2").ocultaEnTienda).toBe(true)
    expect(json.producto.variantes.find((v: { alegraId: string }) => v.alegraId === "v1").ocultaEnTienda).toBe(false)
    expect(aviso.llamadas).toBe(1)
  })

  it("volver a mostrarla la deja sin ocultar", async () => {
    await variantes.PATCH(req("PATCH", { alegraId: "v2", ocultaEnTienda: true }))
    const res = await variantes.PATCH(req("PATCH", { alegraId: "v2", ocultaEnTienda: false }))
    const json = await res.json()
    expect(json.producto.variantes.find((v: { alegraId: string }) => v.alegraId === "v2").ocultaEnTienda).toBe(false)
  })

  it("valida: ocultaEnTienda booleano, no padres ni sueltos; otro tenant es 404", async () => {
    expect((await variantes.PATCH(req("PATCH", { alegraId: "v2", ocultaEnTienda: "si" }))).status).toBe(422)
    const padre = await variantes.PATCH(req("PATCH", { alegraId: "P", ocultaEnTienda: true }))
    expect(padre.status).toBe(422)
    expect((await padre.json()).error).toMatch(/variante de un modelo/)
    expect((await variantes.PATCH(req("PATCH", { alegraId: "otro", ocultaEnTienda: true }))).status).toBe(422)
    expect((await variantes.PATCH(req("PATCH", { alegraId: "ajeno", ocultaEnTienda: true }))).status).toBe(404)
    expect(aviso.llamadas).toBe(0)
  })

  it("un operador no entra y sin sesión es 401", async () => {
    await loginComo("operator")
    expect((await variantes.PATCH(req("PATCH", { alegraId: "v2", ocultaEnTienda: true }))).status).toBe(404)
    session = {}
    expect((await variantes.PATCH(req("PATCH", { alegraId: "v2", ocultaEnTienda: true }))).status).toBe(401)
    expect(aviso.llamadas).toBe(0)
  })
})

describe("la edición de una variante agrupada se rechaza; la del modelo (ancla) no", () => {
  it("PATCH del producto: la variante responde 400 en usted; el padre y los sueltos se editan", async () => {
    const res = await producto.PATCH(req("PATCH", { nombre: "Otro nombre" }), params("v1"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/desde el modelo/)
    const overlays = (await getDb().execute(sql`SELECT 1 FROM catalog_overlay WHERE tenant_id = ${A} AND alegra_id = 'v1'`)) as unknown as unknown[]
    expect(overlays).toHaveLength(0)

    expect((await producto.PATCH(req("PATCH", { nombre: "Cinta LED" }), params("P"))).status).toBe(200)
    expect((await producto.PATCH(req("PATCH", { nombre: "Suelto" }), params("otro"))).status).toBe(200)
  })

  it("un producto sumado a mano también es 'agrupado'; la base del grupo no", async () => {
    await variantes.POST(req("POST", { alegraId: "rgb", grupoId: "otro", etiqueta: "RGB", etiquetaAncla: "Blanco" }))
    expect((await producto.PATCH(req("PATCH", { nombre: "X" }), params("rgb"))).status).toBe(400)
    expect((await producto.PATCH(req("PATCH", { nombre: "Cinta" }), params("otro"))).status).toBe(200)
  })

  it("fotos: sin alcance 400; con ?alcance=variante firma y guarda SOLO la foto en el overlay de la variante", async () => {
    const sinAlcance = await fotos.POST(req("POST", { id: UUID, variantes: [{ ancho: 320, bytes: 1000 }] }), params("v1"))
    expect(sinAlcance.status).toBe(400)
    const putSinAlcance = await fotos.PUT(req("PUT", { fotos: [] }), params("v1"))
    expect(putSinAlcance.status).toBe(400)

    const firma = await fotos.POST(req("POST", { id: UUID, variantes: [{ ancho: 320, bytes: 1000 }] }, "?alcance=variante"), params("v1"))
    expect(firma.status).toBe(200)
    const key = `productos/${A}/v1/${UUID}-320.webp`
    expect((await firma.json()).variantes[0].key).toBe(key)

    const put = await fotos.PUT(req("PUT", { fotos: [{ key, w: 320 }] }, "?alcance=variante"), params("v1"))
    expect(put.status).toBe(200)
    const filas = (await getDb().execute(
      sql`SELECT alegra_id, visible, nombre, jsonb_array_length(fotos) AS n FROM catalog_overlay WHERE tenant_id = ${A}`,
    )) as unknown as { alegra_id: string; visible: boolean | null; nombre: string | null; n: number }[]
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ alegra_id: "v1", n: 1, nombre: null })

    const malo = await fotos.POST(req("POST", { variantes: [{ ancho: 320, bytes: 1000 }] }, "?alcance=otra"), params("v1"))
    expect(malo.status).toBe(400)
  })

  it("fotos del modelo: el ancla sigue sin necesitar el parámetro", async () => {
    const res = await fotos.POST(req("POST", { id: UUID, variantes: [{ ancho: 320, bytes: 1000 }] }), params("P"))
    expect(res.status).toBe(200)
  })

  it("ficha: las escrituras sobre una variante agrupada son 400; sobre el ancla, normales", async () => {
    expect((await ficha.POST(req("POST", { nombre: "f.pdf", bytes: 1000 }), params("v1"))).status).toBe(400)
    expect((await ficha.PUT(req("PUT", { key: `productos/${A}/v1/ficha-${UUID}.pdf`, nombre: "f.pdf", bytes: 1000 }), params("v1"))).status).toBe(400)
    expect((await ficha.DELETE(req("DELETE"), params("v1"))).status).toBe(400)
    expect((await ficha.POST(req("POST", { nombre: "f.pdf", bytes: 1000 }), params("P"))).status).toBe(200)
  })

  it("masiva por ids con una variante agrupada es 400; con el ancla, 200 y escribe en el ancla", async () => {
    const mala = await masiva.POST(req("POST", { seleccion: { tipo: "ids", alegraIds: ["P", "v1"] }, accion: { tipo: "visible", valor: true } }))
    expect(mala.status).toBe(400)
    expect((await mala.json()).error).toMatch(/modelo completo/)

    const ok = await masiva.POST(req("POST", { seleccion: { tipo: "ids", alegraIds: ["P"] }, accion: { tipo: "visible", valor: true } }))
    expect(ok.status).toBe(200)
  })
})
