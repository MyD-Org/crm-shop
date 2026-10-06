import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { alegraCuentas, catalogProducts, listasPrecioOnline } from "@/db/schema"
import { seedOperator, seedTenant, truncateAll } from "./helpers"
import { calcular, seedCategoria, seedLista, seedOverrideCategoria, seedOverrideMarca, seedProducto } from "./precios-online-helpers"

// B.18–B.20 y B.26: rutas /api/admin/precios-online/* y la grilla /api/admin/catalogo/precios-online.
// DB real (crm_test), guard real (rol y tenant salen de la FILA de admin_users). Datos inventados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const listasRuta = await import("@/app/api/admin/precios-online/listas/route")
const previa = await import("@/app/api/admin/precios-online/previsualizar/route")
const aplicarRuta = await import("@/app/api/admin/precios-online/aplicar/route")
const historialRuta = await import("@/app/api/admin/precios-online/historial/route")
const revertirRuta = await import("@/app/api/admin/precios-online/historial/[id]/revertir/route")
const retencionesRuta = await import("@/app/api/admin/precios-online/retenciones/route")
const configRuta = await import("@/app/api/admin/precios-online/config/route")
const alertasRuta = await import("@/app/api/admin/precios-online/alertas/route")
const grillaRuta = await import("@/app/api/admin/catalogo/precios-online/route")

const A = "tenant-a"
const B = "tenant-b"
const NOT_FOUND = { error: "No encontrado", code: "not_found" }

function login(userId: string, tenantId = A) {
  session = { userId, role: "admin", tenantId, name: "Ana Admin", email: "ana.admin@example.com", save: async () => {} }
}

const req = (path: string, init: { method?: string; body?: unknown; host?: string } = {}) => {
  const host = init.host ?? A
  return new NextRequest(`http://${host}.localhost${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${host}.localhost` },
  })
}
const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let adminA: string
let adminB: string
let operador: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  adminA = await seedOperator(A, { role: "admin", email: "a@example.com" })
  adminB = await seedOperator(B, { role: "admin", email: "b@example.com" })
  operador = await seedOperator(A, { role: "operator", email: "op@example.com" })
  login(adminA)
}, 60_000) // la limpieza tras la grilla de 10.000 productos pasa los 10 s del CI
afterAll(async () => {
  await truncateAll()
})

const crear = (nombre: string, coeficiente: number) => ({ op: "crearLista", nombre, coeficiente })

async function previaYAplicar(cambios: unknown[], extra: Record<string, unknown> = {}, host = A) {
  const pr = await json(await previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios }, host })))
  const res = await aplicarRuta.POST(
    req("/api/admin/precios-online/aplicar", {
      body: { cambios, baseVersion: pr.previa.baseVersion, huella: pr.previa.huella, ...extra },
      host,
    }),
  )
  return { previa: pr.previa, res }
}

describe("autorización", () => {
  const todas = () => [
    listasRuta.GET(req("/api/admin/precios-online/listas")),
    previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios: [crear("X", 1.5)] } })),
    aplicarRuta.POST(req("/api/admin/precios-online/aplicar", { body: { cambios: [crear("X", 1.5)], baseVersion: 0, huella: "0".repeat(64) } })),
    historialRuta.GET(req("/api/admin/precios-online/historial")),
    revertirRuta.POST(req("/api/admin/precios-online/historial/x/revertir", { body: { previa: true } }), {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    }),
    retencionesRuta.GET(req("/api/admin/precios-online/retenciones")),
    retencionesRuta.POST(req("/api/admin/precios-online/retenciones", { body: { accion: "aprobar", ids: [] } })),
    configRuta.GET(req("/api/admin/precios-online/config")),
    alertasRuta.GET(req("/api/admin/precios-online/alertas")),
    grillaRuta.GET(req("/api/admin/catalogo/precios-online")),
  ]

  it("sin sesión: 401 en todas las rutas, sin filtrar datos", async () => {
    await seedLista(A, "Lista secreta", "1.5", { esReferencia: true })
    session = {}
    for (const p of todas()) {
      const res = await p
      expect(res.status).toBe(401)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
      expect(JSON.stringify(await res.json())).not.toMatch(/secreta/)
    }
  })

  it("operator: 404 con el cuerpo de un recurso inexistente (el guard admin+ del repo), sin datos", async () => {
    await seedLista(A, "Lista secreta", "1.5", { esReferencia: true })
    login(operador)
    for (const p of todas()) {
      const res = await p
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND)
    }
  })

  it("las respuestas de un admin son NO_STORE", async () => {
    for (const res of [
      await listasRuta.GET(req("/api/admin/precios-online/listas")),
      await configRuta.GET(req("/api/admin/precios-online/config")),
      await alertasRuta.GET(req("/api/admin/precios-online/alertas")),
      await grillaRuta.GET(req("/api/admin/catalogo/precios-online")),
      await historialRuta.GET(req("/api/admin/precios-online/historial")),
    ]) {
      expect(res.status).toBe(200)
      expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    }
  })
})

describe("previsualizar y aplicar", () => {
  it("coeficiente < 1: 400 con el mensaje en usted", async () => {
    const res = await previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios: [crear("X", 0.9)] } }))
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: "El coeficiente debe ser mayor o igual a 1.", code: "invalid" })
  })

  it("lista privada y enlace por la API: previa + aplicar, y GET /listas trae `listasAlegra` del espejo de contactos", async () => {
    await getDb().execute(sql`
      INSERT INTO alegra_contacts (tenant_id, alegra_account, alegra_id, name, price_list_id, price_list_name, status)
      VALUES (${A}, 'principal', 'c1', 'Cliente Uno', '5', 'Mayorista L5', 'active')
    `)
    await previaYAplicar([crear("Lista A", 1.5)])
    await previaYAplicar([{ op: "crearLista", nombre: "Lista L5", coeficiente: 1.2, privada: true }])
    const antes = await json(await listasRuta.GET(req("/api/admin/precios-online/listas")))
    const privada = antes.listas.find((l: { nombre: string }) => l.nombre === "Lista L5")
    expect(privada).toMatchObject({ privada: true, mapeos: [] })
    const { res } = await previaYAplicar([{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: privada.id }])
    expect(res.status).toBe(200)
    const d = await json(await listasRuta.GET(req("/api/admin/precios-online/listas")))
    expect(d.listas.find((l: { nombre: string }) => l.nombre === "Lista L5").mapeos).toMatchObject([
      { alegraAccount: "principal", alegraPriceListId: "5" },
    ])
    expect(d.listasAlegra).toMatchObject([{ alegraAccount: "principal", alegraPriceListId: "5", nombre: "Mayorista L5", contactos: 1 }])
    // Una lista pública no se enlaza: error de usted, 422.
    const pub = d.listas.find((l: { nombre: string }) => l.nombre === "Lista A")
    const pr = await previa.POST(
      req("/api/admin/precios-online/previsualizar", {
        body: { cambios: [{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "9", listaId: pub.id }] },
      }),
    )
    expect(pr.status).toBe(422)
    expect((await json(pr)).error).toBe("Solo una lista privada puede enlazarse con una lista de Alegra.")
  })

  it("flujo completo: previa sin efectos, aplicar, historial", async () => {
    await seedProducto(A, { alegraId: "1", costo: "100" })
    const pr = await json(await previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios: [crear("Lista A", 1.5)] } })))
    expect(pr.previa).toMatchObject({ productosAfectados: 1, nuevos: 1, requiereConfirmacionExtra: false })
    expect((await json(await listasRuta.GET(req("/api/admin/precios-online/listas")))).listas).toEqual([])

    const { res } = await previaYAplicar([crear("Lista A", 1.5)])
    expect(res.status).toBe(200)
    expect((await json(res)).version).toBe(1)
    const listas = await json(await listasRuta.GET(req("/api/admin/precios-online/listas")))
    expect(listas.listas).toMatchObject([{ nombre: "Lista A", coeficiente: "1.5000", esReferencia: true }])
    expect(listas.config).toMatchObject({ version: 1, umbralConfirmacionPct: "20.00", umbralRetencionPct: "10.00" })
    const h = await json(await historialRuta.GET(req("/api/admin/precios-online/historial")))
    expect(h.total).toBe(1)
    // El actor sale de la FILA de admin_users (no de la cookie).
    expect(h.items[0]).toMatchObject({ tipo: "lista_alta", usuario: "a@example.com" })
  })

  it("previa vencida: 409 con el mensaje; sin claves de previa: 400", async () => {
    await seedProducto(A, { alegraId: "1", costo: "100" })
    const cambios = [crear("Lista A", 1.5)]
    const pr = await json(await previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios } })))
    await previaYAplicar([crear("Otra", 1.2)])
    const viejo = await aplicarRuta.POST(req("/api/admin/precios-online/aplicar", { body: { cambios, baseVersion: pr.previa.baseVersion, huella: pr.previa.huella } }))
    expect(viejo.status).toBe(409)
    expect(await json(viejo)).toMatchObject({ code: "previa_vencida", error: "La vista previa quedó desactualizada. Genere una nueva." })
    const sin = await aplicarRuta.POST(req("/api/admin/precios-online/aplicar", { body: { cambios } }))
    expect(sin.status).toBe(400)
  })

  it("confirmación extra: 409 sin ella, 200 con confirmaExtra", async () => {
    const lista = await seedLista(A, "Lista A", "1.5", { esReferencia: true })
    await seedProducto(A, { alegraId: "1", costo: "100" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${A}, NULL::text[], 'config')`)
    const cambios = [{ op: "editarLista", listaId: lista, coeficiente: 1.95 }]
    const sin = await previaYAplicar(cambios)
    expect(sin.res.status).toBe(409)
    expect(await json(sin.res)).toMatchObject({ code: "confirmacion_extra", resultado: { requiereConfirmacionExtra: true } })
    const con = await previaYAplicar(cambios, { confirmaExtra: true })
    expect(con.res.status).toBe(200)
  })

  it("aislamiento: un tenant no puede tocar ni ver las listas de otro", async () => {
    const lista = await seedLista(B, "Lista de B", "1.5", { esReferencia: true })
    const res = await previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios: [{ op: "editarLista", listaId: lista, coeficiente: 3 }] } }))
    expect(res.status).toBe(404)
    expect(await json(res)).toMatchObject({ code: "lista_no_existe" })
    expect((await json(await listasRuta.GET(req("/api/admin/precios-online/listas")))).listas).toEqual([])
    expect(await getDb().select().from(listasPrecioOnline).where(eq(listasPrecioOnline.tenantId, B))).toHaveLength(1)
  })

  it("revertir por la ruta: previa y aplicar; 409 ya_revertido", async () => {
    await seedProducto(A, { alegraId: "1", costo: "100" })
    await previaYAplicar([crear("Lista A", 1.5)])
    const lista = (await json(await listasRuta.GET(req("/api/admin/precios-online/listas")))).listas[0].id
    await previaYAplicar([{ op: "editarLista", listaId: lista, coeficiente: 1.6 }])
    const h = await json(await historialRuta.GET(req("/api/admin/precios-online/historial")))
    const edicion = h.items[0].id
    const ctx = { params: Promise.resolve({ id: edicion }) }
    const pr = await json(await revertirRuta.POST(req(`/api/admin/precios-online/historial/${edicion}/revertir`, { body: { previa: true } }), ctx))
    expect(pr.cambios).toMatchObject([{ op: "editarLista", coeficiente: "1.5000" }])
    const ok = await revertirRuta.POST(
      req(`/api/admin/precios-online/historial/${edicion}/revertir`, { body: { baseVersion: pr.previa.baseVersion, huella: pr.previa.huella } }),
      ctx,
    )
    expect(ok.status).toBe(200)
    const otra = await revertirRuta.POST(req(`/api/admin/precios-online/historial/${edicion}/revertir`, { body: { previa: true } }), ctx)
    expect(otra.status).toBe(409)
    expect(await json(otra)).toMatchObject({ code: "ya_revertido" })
  })
})

describe("retenciones por la ruta", () => {
  it("lista, exige confirmar para varios, aprueba y rechaza", async () => {
    await seedLista(A, "Lista A", "2", { esReferencia: true })
    for (const id of ["1", "2", "3"]) await seedProducto(A, { alegraId: id, costo: "100" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${A}, NULL::text[], 'config')`)
    await getDb().update(catalogProducts).set({ costo: "300" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${A}, NULL::text[], 'costo')`)
    const l = await json(await retencionesRuta.GET(req("/api/admin/precios-online/retenciones")))
    expect(l.total).toBe(3)
    const ids = l.items.map((i: { id: string }) => i.id)
    const sinConfirmar = await retencionesRuta.POST(req("/api/admin/precios-online/retenciones", { body: { accion: "aprobar", ids } }))
    expect(sinConfirmar.status).toBe(400)
    expect(await json(sinConfirmar)).toMatchObject({ error: "Confirme para resolver varios cambios a la vez." })
    const ap = await json(await retencionesRuta.POST(req("/api/admin/precios-online/retenciones", { body: { accion: "aprobar", ids: ids.slice(0, 2), confirmar: true } })))
    expect(ap).toEqual({ resueltos: 2, omitidos: [] })
    const rz = await json(await retencionesRuta.POST(req("/api/admin/precios-online/retenciones", { body: { accion: "rechazar", ids: [ids[2]] } })))
    expect(rz.resueltos).toBe(1)
    expect((await json(await alertasRuta.GET(req("/api/admin/precios-online/alertas")))).alertas.retenidos).toBe(0)
  })

  it("no resuelve retenidos de otro tenant", async () => {
    await seedLista(B, "Lista A", "2", { esReferencia: true })
    await seedProducto(B, { alegraId: "1", costo: "100" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${B}, NULL::text[], 'config')`)
    await getDb().update(catalogProducts).set({ costo: "300" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${B}, NULL::text[], 'costo')`)
    login(adminB, B)
    const id = (await json(await retencionesRuta.GET(req("/api/admin/precios-online/retenciones", { host: B })))).items[0].id
    login(adminA)
    const r = await json(await retencionesRuta.POST(req("/api/admin/precios-online/retenciones", { body: { accion: "aprobar", ids: [id] } })))
    expect(r).toEqual({ resueltos: 0, omitidos: [id] })
  })
})

// La grilla carga 10.000 productos sintéticos: en el runner del CI el test y la limpieza del
// beforeEach pasan los 5 s / 10 s por defecto y el timeout deja la base sucia para los siguientes.
describe("grilla de precios online", { timeout: 60_000 }, () => {
  const grilla = async (query = "") => json(await grillaRuta.GET(req(`/api/admin/catalogo/precios-online${query}`)))

  it("10.000 productos sintéticos: pagina en el servidor (máx. 100), cuenta y ordena por SQL", async () => {
    await seedLista(A, "Lista A", "1.5", { esReferencia: true })
    await getDb().execute(sql`
      INSERT INTO catalog_products (tenant_id, alegra_id, code, name, status, costo, costo_aplicado)
      SELECT ${A}, 'g' || i, 'REF-' || i, 'Producto ' || lpad(i::text, 5, '0'), 'active', (10 + i % 500), (10 + i % 500)
      FROM generate_series(1, 10000) i
    `)
    // Medición del UPDATE masivo (10.000 productos x 1 lista): referencia para el ensayo U3.
    const t0 = Date.now()
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${A}, NULL::text[], 'config')`)
    const ms = Date.now() - t0
    console.info(`[medicion] aplicar_precios_online config, 10000 productos x 1 lista: ${ms} ms`)
    expect(ms).toBeLessThan(10_000)
    const p1 = await grilla("?limit=50")
    expect(p1.total).toBe(10000)
    expect(p1.items).toHaveLength(50)
    expect(p1.items[0].nombre).toBe("Producto 00001")
    const tope = await grilla("?limit=5000")
    expect(tope.items).toHaveLength(100) // máx. 100 por página
    expect(tope.limit).toBe(100)
    const p2 = await grilla("?start=50&limit=50")
    expect(p2.items[0].nombre).toBe("Producto 00051")
    const porPrecio = await grilla("?orden=precio&limit=3")
    expect(porPrecio.items.map((i: { precioReferencia: string }) => i.precioReferencia)).toEqual(["15.00", "15.00", "15.00"])
    expect(porPrecio.items).toHaveLength(3)
    // El cálculo de coeficiente y origen solo corre para la página (cada fila trae su lista).
    expect(p1.items.every((i: { precios: unknown[] }) => i.precios.length === 1)).toBe(true)
  })

  it("origen del coeficiente visible por lista: general, categoría (con herencia) y marca", async () => {
    const lista = await seedLista(A, "Lista A", "1.6", { esReferencia: true })
    const otra = await seedLista(A, "Lista B", "1.2")
    const raiz = await seedCategoria(A, "raiz")
    const hija = await seedCategoria(A, "hija", raiz, 2)
    await seedOverrideCategoria(A, lista, raiz, "1.4")
    await seedOverrideMarca(A, otra, "marca x", "1.3")
    await seedProducto(A, { alegraId: "h", costo: "100", categoriaId: hija, brand: "Marca X" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${A}, NULL::text[], 'config')`)
    const g = await grilla()
    const fila = g.items[0]
    const porLista = Object.fromEntries(fila.precios.map((p: { listaId: string }) => [p.listaId, p]))
    expect(porLista[lista]).toMatchObject({ coeficiente: "1.4000", precio: "140.00", origen: { tipo: "categoria", categoriaNombre: "Categoría raiz", heredado: true } })
    expect(porLista[otra]).toMatchObject({ coeficiente: "1.3000", precio: "130.00", origen: { tipo: "marca", marca: "marca x" } })
    expect(fila).toMatchObject({ costo: "100.0000", categoriaNombre: "Categoría hija", precioReferencia: "140.00", estado: "ok" })
  })

  it("filtros: q, marca, categoría, estado", async () => {
    await seedLista(A, "Lista A", "1.5", { esReferencia: true })
    const cat = await seedCategoria(A, "c")
    await seedProducto(A, { alegraId: "1", costo: "100", brand: "Marca X", categoriaId: cat })
    await seedProducto(A, { alegraId: "2", costo: null, brand: "Y" })
    await seedProducto(A, { alegraId: "3", costo: "50", brand: "Y" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${A}, NULL::text[], 'config')`)
    const ids = async (q: string) => (await grilla(q)).items.map((i: { alegraId: string }) => i.alegraId).sort()
    expect(await ids("?q=producto 3")).toEqual(["3"])
    expect(await ids("?marca=marca x")).toEqual(["1"])
    expect(await ids(`?categoria=${cat}`)).toEqual(["1"])
    expect(await ids("?categoria=sin")).toEqual(["2", "3"])
    expect(await ids("?estado=sin-costo")).toEqual(["2"])
    expect(await ids("?estado=nuevo")).toEqual(["2", "3"])
    expect(await ids("?estado=ok")).toEqual(["1", "3"])
    expect((await grillaRuta.GET(req("/api/admin/catalogo/precios-online?estado=cualquiera"))).status).toBe(400)
    expect((await grillaRuta.GET(req("/api/admin/catalogo/precios-online?categoria=no-uuid"))).status).toBe(400)
  })

  it("aísla por tenant", async () => {
    await seedProducto(A, { alegraId: "1", costo: "100" })
    await seedProducto(B, { alegraId: "2", costo: "100" })
    expect((await grilla()).items.map((i: { alegraId: string }) => i.alegraId)).toEqual(["1"])
  })

  it("el costo solo viaja al admin (la ruta es admin+; el operador no recibe nada)", async () => {
    await seedProducto(A, { alegraId: "1", costo: "123.45" })
    expect(JSON.stringify(await grilla())).toContain("123.4500")
    login(operador)
    const res = await grillaRuta.GET(req("/api/admin/catalogo/precios-online"))
    expect(JSON.stringify(await res.json())).not.toContain("123.45")
  })
})

describe("referencia de las listas de Alegra por cuenta (B.26, solo informativa)", () => {
  async function conPar() {
    await seedLista(A, "Lista A", "1.5", { esReferencia: true })
    const [mdp] = await getDb()
      .insert(alegraCuentas)
      .values({ tenantId: A, slug: "mdp", nombre: "MDP", principal: false })
      .returning()
    await getDb().insert(alegraCuentas).values({ tenantId: A, slug: "igz", nombre: "IGZ", principal: true })
    await seedProducto(A, {
      alegraId: "100",
      costo: "100",
      rawPrice: [
        { idPriceList: "1", name: "General IGZ", price: 500 },
        { idPriceList: "2", name: "Mayorista IGZ", price: 400 },
      ],
    })
    // El par en MDP: la principal lo absorbió (reemplazado_por_alegra_id).
    await seedProducto(A, { alegraId: "mdp:9", costo: "90", status: "inactive", rawPrice: [{ idPriceList: "7", name: "General MDP", price: 480 }] })
    await getDb()
      .update(catalogProducts)
      .set({ cuentaId: mdp.id, alegraIdCuenta: "9", reemplazadoPorAlegraId: "100" })
      .where(eq(catalogProducts.alegraId, "mdp:9"))
    // Solo-MDP.
    await seedProducto(A, { alegraId: "mdp:10", costo: "20", rawPrice: [{ idPriceList: "7", name: "General MDP", price: 99 }] })
    await getDb().update(catalogProducts).set({ cuentaId: mdp.id, alegraIdCuenta: "10" }).where(eq(catalogProducts.alegraId, "mdp:10"))
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${A}, NULL::text[], 'config')`)
  }
  const grilla = async (q = "") => json(await grillaRuta.GET(req(`/api/admin/catalogo/precios-online${q}`)))
  type Ref = { cuenta: string; listaNombre: string; precio: number }

  it("un producto en ambas cuentas muestra los dos juegos bajo cada cuenta, con el nombre de la lista", async () => {
    await conPar()
    const g = await grilla()
    const par = g.items.find((i: { alegraId: string }) => i.alegraId === "100")
    expect(par.referenciaAlegra.map((r: Ref) => `${r.cuenta}|${r.listaNombre}|${r.precio}`)).toEqual([
      "IGZ|General IGZ|500",
      "IGZ|Mayorista IGZ|400",
      "MDP|General MDP|480",
    ])
    expect(par.referenciaAlegra[0]).toMatchObject({ principal: true })
  })

  it("un producto solo-MDP muestra solo las listas de MDP", async () => {
    await conPar()
    const solo = (await grilla()).items.find((i: { alegraId: string }) => i.alegraId === "mdp:10")
    expect(solo.referenciaAlegra.map((r: Ref) => `${r.cuenta}|${r.listaNombre}|${r.precio}`)).toEqual(["MDP|General MDP|99"])
  })

  it("no influye: cambiar los precios de Alegra no altera precios online ni la previa", async () => {
    await conPar()
    const antes = await calcular(A)
    const previaAntes = await json(await previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios: [crear("Lista B", 1.2)] } })))
    await getDb().update(catalogProducts).set({ raw: { price: [{ idPriceList: "1", name: "Otra", price: 1 }] }, prices: [{ idPriceList: "1", name: "Otra", price: 1 }] })
    expect(await calcular(A)).toEqual(antes)
    const previaDespues = await json(await previa.POST(req("/api/admin/precios-online/previsualizar", { body: { cambios: [crear("Lista B", 1.2)] } })))
    // Mismo resumen y misma huella (el uuid de la lista nueva cambia entre previas: no se compara).
    const sinIds = ({ muestra, ...resto }: Record<string, unknown>) => ({ ...resto, muestra: (muestra as { listaId: string }[]).map(({ listaId: _l, ...m }) => m) }) // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(sinIds(previaDespues.previa)).toEqual(sinIds(previaAntes.previa))
    const fila = (await grilla()).items.find((i: { alegraId: string }) => i.alegraId === "100")
    expect(fila.precioReferencia).toBe("150.00") // sigue siendo costo x coeficiente
  })

  it("solo para los ids de la página y solo en el admin", async () => {
    await conPar()
    const pagina = await grilla("?limit=1")
    expect(pagina.items).toHaveLength(1)
    // Lo único que lleva referenciaAlegra es la fila pedida.
    expect(JSON.stringify(pagina).match(/referenciaAlegra/g)).toHaveLength(1)
    login(operador)
    const res = await grillaRuta.GET(req("/api/admin/catalogo/precios-online"))
    expect(JSON.stringify(await res.json())).not.toMatch(/General IGZ/)
  })
})
