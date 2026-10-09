import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mintAgentToken } from "@/lib/agent-token"
import { authAgentInternalRequest, authAgentTenantRequest } from "@/lib/agent-auth"

// El crm_token del cliente llega al navegador (viaja dentro del JWT de sesión del widget), así
// que las rutas que operan sobre cualquier contacto del tenant (contacts, quotes) sólo aceptan
// INTERNAL_SECRET. Las de datos públicos del tenant (catálogo, precios) aceptan ambos.

const INTERNAL = "internal-secret-de-test-para-vitest-nada-real"
const req = (auth?: string) =>
  new Request("https://t1.plataforma.example/api/agent/x", { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.stubEnv("INTERNAL_SECRET", INTERNAL)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("authAgentInternalRequest (contacts, quotes)", () => {
  it("acepta INTERNAL_SECRET y responde 'internal'", () => {
    expect(authAgentInternalRequest(req(`Bearer ${INTERNAL}`))).toEqual({ codigocliente: "internal" })
  })

  it("rechaza un crm_token válido aunque sea del tenant del request", () => {
    const crmToken = mintAgentToken("CLI-1", "t1")
    // Sanity: el mismo token sí vale para las rutas de datos públicos del tenant.
    expect(authAgentTenantRequest(req(`Bearer ${crmToken}`), "t1")).toEqual({ codigocliente: "CLI-1" })
    expect(authAgentInternalRequest(req(`Bearer ${crmToken}`))).toBeNull()
  })

  it("rechaza sin header, con otro esquema, con otro secreto y con INTERNAL_SECRET sin configurar", () => {
    expect(authAgentInternalRequest(req())).toBeNull()
    expect(authAgentInternalRequest(req(INTERNAL))).toBeNull()
    expect(authAgentInternalRequest(req(`Bearer ${INTERNAL}x`))).toBeNull()
    vi.stubEnv("INTERNAL_SECRET", "")
    expect(authAgentInternalRequest(req(`Bearer ${INTERNAL}`))).toBeNull()
    expect(authAgentInternalRequest(req("Bearer "))).toBeNull()
  })
})

describe("authAgentTenantRequest (catalog, prices, payment-terms, sales-config)", () => {
  it("acepta INTERNAL_SECRET o un crm_token del mismo tenant; rechaza el de otro tenant", () => {
    expect(authAgentTenantRequest(req(`Bearer ${INTERNAL}`), "t1")).toEqual({ codigocliente: "internal" })
    expect(authAgentTenantRequest(req(`Bearer ${mintAgentToken("CLI-1", "t1")}`), "t1")).toEqual({ codigocliente: "CLI-1" })
    expect(authAgentTenantRequest(req(`Bearer ${mintAgentToken("CLI-1", "t2")}`), "t1")).toBeNull()
    expect(authAgentTenantRequest(req(), "t1")).toBeNull()
  })
})
