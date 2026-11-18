import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { adminUsers, catalogProducts } from "@/db/schema"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Permisos por sección, S2b-ii (catálogo y tienda) y S2b-iii (sucursales, envíos y mensajes). DB real (crm_test), guard real
// (`requireSeccion`): rol y secciones salen de la FILA de admin_users, no de la cookie.
//
// Protege:
//   1. Columnas NULL = comportamiento de antes (admin pasa, operador 404).
//   2. «settings» no es un recurso compartido: cada subruta pide su sección (spec, escenario
//      "Ruta compartida settings").
//   3. Las rutas any-of sólo abren lo que su consumidor de la otra sección necesita: Etiquetas lee
//      el listado de productos (no la ficha); Catálogo lee medios de pago y modalidades sin stock
//      (no los escribe).

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const schedule = await import("@/app/api/admin/settings/schedule/route")
const tiendaOnline = await import("@/app/api/admin/settings/tienda-online/route")
const chatTienda = await import("@/app/api/admin/settings/chat-tienda/route")
const productos = await import("@/app/api/admin/catalogo/productos/route")
const producto = await import("@/app/api/admin/catalogo/productos/[alegraId]/route")
const mediosPago = await import("@/app/api/admin/medios-pago-shop/route")
const modalidades = await import("@/app/api/admin/modalidades-sin-stock/route")
const sucursalesRuta = await import("@/app/api/admin/sucursales/route")
const sucursalRuta = await import("@/app/api/admin/sucursales/[slug]/route")
const zonasRuta = await import("@/app/api/admin/sucursales/zonas/route")
const alegraCuentas = await import("@/app/api/admin/alegra-cuentas/route")
const reglasVenta = await import("@/app/api/admin/reglas-venta/route")
const enviosRuta = await import("@/app/api/admin/envios/route")
const metodosEnvio = await import("@/app/api/admin/metodos-envio/route")
const inboxCanales = await import("@/app/api/admin/inbox/canales/route")

const TENANT_A = "tenant-a"
const NOT_FOUND_BODY = { error: "No encontrado", code: "not_found" }

function login(userId: string, role: string) {
  session = { mfa: "ok", userId, role, tenantId: TENANT_A, name: "Ana", email: "ana@cliente.example", save: async () => {} }
}

const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://${TENANT_A}.localhost${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${TENANT_A}.localhost` },
  })

const params = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

async function secciones(userId: string, lista: string[] | null) {
  await getDb().update(adminUsers).set({ seccionesPermitidas: lista }).where(eq(adminUsers.id, userId))
}

async function esNotFound(res: Response) {
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual(NOT_FOUND_BODY)
}

let admin: string
let operador: string

describe("permisos por sección — catálogo y tienda (S2b-ii)", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    admin = await seedOperator(TENANT_A, { role: "admin", email: "admin@cliente.example" })
    operador = await seedOperator(TENANT_A, { role: "operator", email: "op@cliente.example" })
    await getDb()
      .insert(catalogProducts)
      .values({ tenantId: TENANT_A, alegraId: "1", name: "COD-1", description: "Producto 1", status: "active" })
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("con columnas NULL: admin entra y el operador recibe 404, como antes", async () => {
    login(admin, "admin")
    expect((await schedule.GET(req("/api/admin/settings/schedule"))).status).toBe(200)
    expect((await tiendaOnline.GET(req("/api/admin/settings/tienda-online"))).status).toBe(200)
    expect((await productos.GET(req("/api/admin/catalogo/productos"))).status).toBe(200)

    login(operador, "operator")
    await esNotFound(await schedule.GET(req("/api/admin/settings/schedule")))
    await esNotFound(await tiendaOnline.GET(req("/api/admin/settings/tienda-online")))
    await esNotFound(await productos.GET(req("/api/admin/catalogo/productos")))
  })

  it("admin con Horarios y sin Tienda online: entra a settings/schedule y no a settings/tienda-online", async () => {
    await secciones(admin, ["horarios"])
    login(admin, "admin")
    expect((await schedule.GET(req("/api/admin/settings/schedule"))).status).toBe(200)
    await esNotFound(await tiendaOnline.GET(req("/api/admin/settings/tienda-online")))
    await esNotFound(await chatTienda.GET(req("/api/admin/settings/chat-tienda")))
  })

  it("operador con Etiquetas: lee el listado de productos pero no la ficha ni la edición", async () => {
    await secciones(operador, ["etiquetas"])
    login(operador, "operator")
    const lista = await productos.GET(req("/api/admin/catalogo/productos"))
    expect(lista.status).toBe(200)
    expect((await lista.json()).total).toBe(1)
    await esNotFound(await producto.GET(req("/api/admin/catalogo/productos/1"), params("1")))
    await esNotFound(
      await producto.PATCH(req("/api/admin/catalogo/productos/1", { method: "PATCH", body: { visible: true } }), params("1")),
    )
  })

  it("admin con Catálogo: lee modalidades sin stock pero no las crea, ni da de alta medios de pago", async () => {
    await secciones(admin, ["catalogo"])
    login(admin, "admin")
    expect((await modalidades.GET(req("/api/admin/modalidades-sin-stock"))).status).toBe(200)
    await esNotFound(await modalidades.POST(req("/api/admin/modalidades-sin-stock", { body: { nombre: "A pedido" } })))
    await esNotFound(await mediosPago.POST(req("/api/admin/medios-pago-shop", { body: { slug: "x" } })))
  })

  it("admin con Pagos y cuotas y sin Catálogo ni Envíos: no ve el catálogo ni las modalidades", async () => {
    await secciones(admin, ["cuotas"])
    login(admin, "admin")
    await esNotFound(await productos.GET(req("/api/admin/catalogo/productos")))
    await esNotFound(await modalidades.GET(req("/api/admin/modalidades-sin-stock")))
  })
})

describe("permisos por sección — sucursales, envíos y mensajes (S2b-iii)", () => {
  const slug = (s: string) => ({ params: Promise.resolve({ slug: s }) })

  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    admin = await seedOperator(TENANT_A, { role: "admin", email: "admin@cliente.example" })
    operador = await seedOperator(TENANT_A, { role: "operator", email: "op@cliente.example" })
  })

  afterAll(async () => {
    await truncateAll()
  })

  it("con columnas NULL: admin entra; el operador sólo a Mensajes (los nombres de canal los lee, no los edita)", async () => {
    login(admin, "admin")
    expect((await sucursalesRuta.GET(req("/api/admin/sucursales"))).status).toBe(200)
    expect((await reglasVenta.GET(req("/api/admin/reglas-venta"))).status).toBe(200)
    expect((await enviosRuta.GET(req("/api/admin/envios"))).status).toBe(200)
    expect((await alegraCuentas.GET(req("/api/admin/alegra-cuentas"))).status).toBe(200)
    expect((await inboxCanales.GET(req("/api/admin/inbox/canales"))).status).toBe(200)

    login(operador, "operator")
    // Antes 200 (requireSucursalesAccess era operador o superior): ahora 404, como la página.
    await esNotFound(await sucursalesRuta.GET(req("/api/admin/sucursales")))
    await esNotFound(await reglasVenta.GET(req("/api/admin/reglas-venta")))
    await esNotFound(await enviosRuta.GET(req("/api/admin/envios")))
    await esNotFound(await alegraCuentas.GET(req("/api/admin/alegra-cuentas")))
    expect((await inboxCanales.GET(req("/api/admin/inbox/canales"))).status).toBe(200)
    await esNotFound(await inboxCanales.PUT(req("/api/admin/inbox/canales", { method: "PUT", body: { nombres: {} } })))
  })

  it("admin con Pagos y cuotas: lee el listado de sucursales (cuentas bancarias) pero no da altas ni ve Alegra ni Envíos", async () => {
    await secciones(admin, ["cuotas"])
    login(admin, "admin")
    expect((await sucursalesRuta.GET(req("/api/admin/sucursales"))).status).toBe(200)
    await esNotFound(await sucursalesRuta.POST(req("/api/admin/sucursales", { body: { slug: "aaa", nombre: "Aaa" } })))
    await esNotFound(await alegraCuentas.GET(req("/api/admin/alegra-cuentas")))
    await esNotFound(await enviosRuta.GET(req("/api/admin/envios")))
    await esNotFound(await zonasRuta.GET(req("/api/admin/sucursales/zonas")))
  })

  it("admin con Envíos y sin Sucursales: lee sucursales, zonas y reglas; sólo escribe los campos de Envíos", async () => {
    await secciones(admin, ["envios"])
    login(admin, "admin")
    expect((await sucursalesRuta.GET(req("/api/admin/sucursales"))).status).toBe(200)
    expect((await zonasRuta.GET(req("/api/admin/sucursales/zonas"))).status).toBe(200)
    expect((await reglasVenta.GET(req("/api/admin/reglas-venta"))).status).toBe(200)
    expect((await metodosEnvio.GET(req("/api/admin/metodos-envio"))).status).toBe(200)
    await esNotFound(await reglasVenta.PUT(req("/api/admin/reglas-venta", { method: "PUT", body: { reservaDias: 3 } })))
    await esNotFound(
      await sucursalRuta.PATCH(req("/api/admin/sucursales/aaa", { method: "PATCH", body: { nombre: "Otro" } }), slug("aaa")),
    )
    await esNotFound(await sucursalRuta.DELETE(req("/api/admin/sucursales/aaa", { method: "DELETE" }), slug("aaa")))
    await esNotFound(await alegraCuentas.GET(req("/api/admin/alegra-cuentas")))
  })

  it("admin sin Mensajes no llega a inbox; operador con Pedidos y sin Mensajes tampoco", async () => {
    await secciones(admin, ["sucursales"])
    login(admin, "admin")
    await esNotFound(await inboxCanales.GET(req("/api/admin/inbox/canales")))
    expect((await sucursalesRuta.GET(req("/api/admin/sucursales"))).status).toBe(200)
    await esNotFound(await enviosRuta.GET(req("/api/admin/envios")))

    await secciones(operador, ["pedidos"])
    login(operador, "operator")
    await esNotFound(await inboxCanales.GET(req("/api/admin/inbox/canales")))
  })
})
