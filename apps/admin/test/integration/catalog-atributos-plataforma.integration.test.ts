import { describe, it, expect, beforeEach, vi } from "vitest"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants, catalogAtributos } from "@/db/schema"
import { truncateAll, seedTenant } from "./helpers"

const llamadas = vi.hoisted(() => [] as { spec: string; clave: string; body: unknown }[])
const falla = vi.hoisted(() => ({ claves: {} as Record<string, "400" | "plano"> }))
vi.mock("@/lib/plataforma-cliente", async (orig) => ({
  ...(await orig<typeof import("@/lib/plataforma-cliente")>()),
  upsertInstancia: async (_t: unknown, spec: string, clave: string, body: unknown) => {
    llamadas.push({ spec, clave, body })
    const f = falla.claves[clave]
    if (f === "400") { const { PlataformaError } = await import("@/lib/plataforma-cliente"); throw new PlataformaError(400, "invalid_data", ["x"], false) }
    if (f === "plano") throw new Error("boom")
    return { created: true, changed: true }
  },
}))

import { reemplazarAtributosDeNombre, guardarAtributosManual, upsertAtributos } from "@/lib/catalogo-atributos-repo"

const T = "central-led"
const PROD = [{ alegraId: "42", name: "Lámpara LED 20W 3000K", description: null }]

const setModo = (modo: "off" | "dual" | "on") =>
  getDb().update(tenants).set({ plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s", plataformaAtributos: modo }).where(eq(tenants.id, T))
const locales = () => getDb().select().from(catalogAtributos).where(and(eq(catalogAtributos.tenantId, T), eq(catalogAtributos.alegraId, "42")))

describe("escritores de atributos según el modo", () => {
  beforeEach(async () => {
    await truncateAll(); await seedTenant(T); llamadas.length = 0; falla.claves = {}
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
    const filas = await getDb().select().from(catalogAtributos).where(eq(catalogAtributos.tenantId, T))
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
