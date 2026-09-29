import { afterEach, describe, expect, it, vi } from "vitest"
import { probarConexionAlegra } from "./alegra"
import type { TenantConfig } from "./tenants"

const CONFIG: TenantConfig = {
  id: "t",
  name: "T",
  subtitle: "",
  logoPath: "",
  alegraEmail: "a@empresa.example",
  alegraToken: "tk-secreto-9999",
  alegraMock: false,
  whatsappNumber: "",
  resendFrom: "x@empresa.example",
  receiptsEmail: "",
  aiApiBaseUrl: "",
  aiApiKey: "",
  aiAgentId: "",
  aiTenantId: "",
}

afterEach(() => vi.unstubAllGlobals())

const respuesta = (status: number, body: unknown = []) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("probarConexionAlegra", () => {
  it("pide un solo ítem (solo lectura) y responde ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(200))
    vi.stubGlobal("fetch", fetchMock)
    expect(await probarConexionAlegra(CONFIG)).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/items?")
    expect(String(url)).toContain("limit=1")
    expect(init.method).toBe("GET")
  })
  it("401 y 403 son credenciales rechazadas, sin filtrar el detalle de Alegra", async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(status, { message: "detalle interno tk-secreto-9999" })))
      const r = await probarConexionAlegra(CONFIG)
      expect(r).toMatchObject({ ok: false, motivo: "credenciales" })
      expect(JSON.stringify(r)).not.toContain("tk-secreto")
    }
  })
  it("otro error HTTP o de red: mensaje genérico", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(500, "boom")))
    expect(await probarConexionAlegra(CONFIG)).toMatchObject({ ok: false, motivo: "error" })
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")))
    expect(await probarConexionAlegra(CONFIG)).toMatchObject({ ok: false, motivo: "error" })
  })
  it("en mock no sale a la red", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await probarConexionAlegra({ ...CONFIG, alegraMock: true })).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
