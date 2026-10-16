import { describe, it, expect, beforeEach, vi } from "vitest"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants, catalogAtributosLegacy } from "@/db/schema"
import { truncateAll, seedTenant } from "./helpers"
import { upsertProyeccion } from "@/lib/plataforma-proyeccion-repo"

const llamadas = vi.hoisted(() => [] as { spec: string; clave: string; body: unknown }[])
const falla = vi.hoisted(() => ({ claves: {} as Record<string, "400" | "plano" | "red"> }))
// Instancia que devuelve el PATCH (por clave); sin entrada, la respuesta no trae instancia.
const respuesta = vi.hoisted(() => ({ instancias: {} as Record<string, { data: Record<string, unknown>; updatedAt?: string }> }))
vi.mock("@/lib/plataforma-cliente", async (orig) => ({
  ...(await orig<typeof import("@/lib/plataforma-cliente")>()),
  upsertInstancia: async (_t: unknown, spec: string, clave: string, body: unknown) => {
    llamadas.push({ spec, clave, body })
    const f = falla.claves[clave]
    const { PlataformaError } = await import("@/lib/plataforma-cliente")
    if (f === "400") throw new PlataformaError(400, "invalid_data", ["/potencia_w/n must be <= 100000"], false)
    if (f === "red") throw new PlataformaError(0, "red", ["fetch failed"], true)
    if (f === "plano") throw new Error("boom")
    return { created: true, changed: true, instance: respuesta.instancias[clave] ?? null }
  },
}))

import {
  reemplazarAtributosDeNombre,
  guardarAtributosManual,
  upsertAtributos,
  leerAtributos,
  leerAtributosDeProductos,
  leerFilasAtributos,
  ErrorGuardadoAtributos,
} from "@/lib/catalogo-atributos-repo"

const T = "central-led"
const PROD = [{ alegraId: "42", name: "Lámpara LED 20W 3000K", description: null }]

const setModo = (modo: "off" | "dual" | "on") =>
  getDb().update(tenants).set({ plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s", plataformaAtributos: modo }).where(eq(tenants.id, T))
const locales = () => getDb().select().from(catalogAtributosLegacy).where(and(eq(catalogAtributosLegacy.tenantId, T), eq(catalogAtributosLegacy.alegraId, "42")))

describe("escritores de atributos según el modo", () => {
  beforeEach(async () => {
    await truncateAll(); await seedTenant(T); llamadas.length = 0; falla.claves = {}; respuesta.instancias = {}
  })

  it("dual: escribe catalog_atributos como siempre Y manda el mismo producto con reemplaza_fuente", async () => {
    await setModo("dual")
    await reemplazarAtributosDeNombre(T, PROD)
    const claves = (await locales()).map((f) => f.clave).sort()
    expect(claves).toEqual(["potencia_w", "temperatura_k", "tono"])
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].clave).toBe("42")
    expect(llamadas[0].body).toEqual({ data: { potencia_w: { n: 20, t: null }, temperatura_k: { n: 3000, t: null }, tono: { n: null, t: "calido" } }, meta: { fuente: "nombre", reemplaza_fuente: true } })
  })

  it("off: sólo la tabla local, ninguna llamada a la plataforma", async () => {
    await reemplazarAtributosDeNombre(T, PROD)
    expect((await locales()).length).toBe(3)
    expect(llamadas).toHaveLength(0)
  })

  it("on: la tabla local queda intacta y la plataforma recibe todo; upsertAtributos cuenta filas aceptadas", async () => {
    await setModo("on")
    const r = await reemplazarAtributosDeNombre(T, PROD)
    expect(await locales()).toHaveLength(0)
    expect(llamadas).toHaveLength(1)
    expect(r.escritas).toBe(3)
    const n = await upsertAtributos(T, [{ alegraId: "42", clave: "ip", valorNum: 65, valorTexto: null }], "pdf")
    expect(n).toBe(1)
    expect(await locales()).toHaveLength(0)
  })

  it("on: el panel manual manda valores y quitar (null) con fuente manual", async () => {
    await setModo("on")
    await guardarAtributosManual(T, "42", [{ clave: "ip", valorNum: 65, valorTexto: null }], ["potencia_w"])
    expect(llamadas[0].body).toEqual({ data: { ip: { n: 65, t: null }, potencia_w: null }, meta: { fuente: "manual" } })
    expect(await locales()).toHaveLength(0)
  })

  it("dual: un 400 y un error plano en dos productos no tumban la sync; las filas locales de todos quedan", async () => {
    await setModo("dual")
    falla.claves = { "1": "400", "2": "plano" }
    const prods = [
      { alegraId: "1", name: "Lámpara LED 10W", description: null },
      { alegraId: "2", name: "Lámpara LED 20W", description: null },
      { alegraId: "3", name: "Lámpara LED 30W", description: null },
    ]
    await expect(reemplazarAtributosDeNombre(T, prods)).resolves.toBeDefined()
    const filas = await getDb().select().from(catalogAtributosLegacy).where(eq(catalogAtributosLegacy.tenantId, T))
    expect([...new Set(filas.map((f) => f.alegraId))].sort()).toEqual(["1", "2", "3"])
    expect(llamadas).toHaveLength(3)
  })

  it("dual: un producto sin atributos en el nombre viaja con data {} y reemplaza_fuente", async () => {
    await setModo("dual")
    await reemplazarAtributosDeNombre(T, [{ alegraId: "99", name: "Producto sin datos", description: null }])
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].body).toEqual({ data: {}, meta: { fuente: "nombre", reemplaza_fuente: true } })
  })
})

// Lectores del admin tras el corte (revisión R6): en `on` la proyección (lo que ve el Shop) con la
// fuente de `data->'fuentes'`; en `off`/`dual` la tabla local, que en esos modos es la viva.
describe("lectores de atributos según el modo", () => {
  const PROY_AT = new Date("2026-10-15T12:00:00.000Z")
  beforeEach(async () => {
    await truncateAll(); await seedTenant(T); llamadas.length = 0; falla.claves = {}; respuesta.instancias = {}
    // Tabla local congelada (vieja) y proyección (actual) con valores DISTINTOS para distinguirlas.
    await getDb().insert(catalogAtributosLegacy).values([
      { tenantId: T, alegraId: "42", clave: "potencia_w", valorNum: "10", valorTexto: null, fuente: "nombre" },
      { tenantId: T, alegraId: "43", clave: "ip", valorNum: "44", valorTexto: null, fuente: "manual" },
    ])
    await upsertProyeccion(T, "atributos_tecnicos", "42", "i42", { tono: { n: null, t: "calido" }, potencia_w: { n: 20, t: null }, vacia: { n: null, t: null }, fuentes: { potencia_w: "pdf", tono: "nombre" } }, PROY_AT)
    await upsertProyeccion(T, "atributos_tecnicos", "43", "i43", { ip: { n: 65, t: null }, fuentes: { ip: "manual" } }, PROY_AT)
  })

  it("on: leerAtributos lee la proyección (valores, fuente por clave, updated_at de la instancia) y no la tabla vieja", async () => {
    await setModo("on")
    expect(await leerAtributos(T, "42")).toEqual([
      { clave: "potencia_w", valorNum: 20, valorTexto: null, fuente: "pdf", updatedAt: PROY_AT.toISOString() },
      { clave: "tono", valorNum: null, valorTexto: "calido", fuente: "nombre", updatedAt: PROY_AT.toISOString() },
    ])
    const m = await leerAtributosDeProductos(T, ["42", "43"])
    expect(Object.fromEntries(m)).toEqual({
      "42|potencia_w": { fuente: "pdf", valorNum: 20, valorTexto: null },
      "42|tono": { fuente: "nombre", valorNum: null, valorTexto: "calido" },
      "43|ip": { fuente: "manual", valorNum: 65, valorTexto: null },
    })
    expect((await leerFilasAtributos(T)).map((f) => `${f.alegraId}|${f.clave}`)).toEqual(["42|potencia_w", "42|tono", "43|ip"])
    expect((await leerAtributosDeProductos(T, [])).size).toBe(0)
  })

  it("on: una clave sin entrada en `fuentes` se lee como la de menor precedencia", async () => {
    await setModo("on")
    await upsertProyeccion(T, "atributos_tecnicos", "44", "i44", { ip: { n: 54, t: null } }, PROY_AT)
    expect(await leerAtributos(T, "44")).toMatchObject([{ clave: "ip", valorNum: 54, fuente: "nombre" }])
  })

  it("off y dual: leen la tabla local, con la misma forma", async () => {
    for (const modo of ["off", "dual"] as const) {
      await setModo(modo)
      const a = await leerAtributos(T, "42")
      expect(a).toMatchObject([{ clave: "potencia_w", valorNum: 10, valorTexto: null, fuente: "nombre" }])
      expect(typeof a[0].updatedAt).toBe("string")
      expect(Object.fromEntries(await leerAtributosDeProductos(T, ["42", "43"]))).toEqual({
        "42|potencia_w": { fuente: "nombre", valorNum: 10, valorTexto: null },
        "43|ip": { fuente: "manual", valorNum: 44, valorTexto: null },
      })
    }
  })
})

// Panel manual en `on` (revisión I-6): la plataforma es la única escritura, así que un rechazo o una
// caída se le muestran al operador, y lo guardado vuelve en la respuesta sin esperar al webhook.
describe("guardarAtributosManual en modo on", () => {
  beforeEach(async () => {
    await truncateAll(); await seedTenant(T); llamadas.length = 0; falla.claves = {}; respuesta.instancias = {}
    await setModo("on")
    await upsertProyeccion(T, "atributos_tecnicos", "42", "i42", { potencia_w: { n: 20, t: null }, tono: { n: null, t: "calido" }, fuentes: { potencia_w: "nombre", tono: "nombre" } }, new Date("2026-10-15T12:00:00Z"))
  })

  it("un 400 de la plataforma tira ErrorGuardadoAtributos 422 con el motivo", async () => {
    falla.claves = { "42": "400" }
    const err = await guardarAtributosManual(T, "42", [{ clave: "potencia_w", valorNum: 999999, valorTexto: null }], []).catch((e) => e)
    expect(err).toBeInstanceOf(ErrorGuardadoAtributos)
    expect(err).toMatchObject({ estado: 422, paraUsuario: "La plataforma rechazó los valores: un valor está fuera de rango (potencia_w)." })
  })

  it("una caída (red o error plano) tira ErrorGuardadoAtributos 502 con el mensaje de reintento", async () => {
    for (const f of ["red", "plano"] as const) {
      falla.claves = { "42": f }
      await expect(guardarAtributosManual(T, "42", [{ clave: "ip", valorNum: 65, valorTexto: null }], [])).rejects.toMatchObject({
        estado: 502,
        paraUsuario: "No se pudo guardar en la plataforma. Inténtelo de nuevo.",
      })
    }
  })

  it("éxito con instancia en la respuesta: devuelve lo que guardó la plataforma (sin `fuentes`, en el orden de las claves)", async () => {
    respuesta.instancias["42"] = {
      data: { tono: { n: null, t: "calido" }, ip: { n: 65, t: null }, fuentes: { tono: "nombre", ip: "manual" } },
      updatedAt: "2026-10-15T13:00:00.000Z",
    }
    const r = await guardarAtributosManual(T, "42", [{ clave: "ip", valorNum: 65, valorTexto: null }], ["potencia_w"])
    expect(r).toEqual([
      { clave: "tono", valorNum: null, valorTexto: "calido", fuente: "nombre", updatedAt: "2026-10-15T13:00:00.000Z" },
      { clave: "ip", valorNum: 65, valorTexto: null, fuente: "manual", updatedAt: "2026-10-15T13:00:00.000Z" },
    ])
  })

  it("éxito sin instancia en la respuesta: lo enviado sobre la proyección (que todavía no recibió el webhook)", async () => {
    const r = await guardarAtributosManual(T, "42", [{ clave: "potencia_w", valorNum: 45, valorTexto: null }], ["tono"])
    expect(r).toMatchObject([{ clave: "potencia_w", valorNum: 45, valorTexto: null, fuente: "manual" }])
    expect(r).toHaveLength(1)
  })

  it("dual: un fallo de la plataforma no tira y devuelve null (la ruta relee la tabla local)", async () => {
    await setModo("dual")
    falla.claves = { "42": "400" }
    expect(await guardarAtributosManual(T, "42", [{ clave: "ip", valorNum: 65, valorTexto: null }], [])).toBeNull()
    expect((await locales()).map((f) => f.clave)).toEqual(["ip"])
  })
})
