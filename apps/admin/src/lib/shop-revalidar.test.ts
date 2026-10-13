import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { pingShopRevalidarCatalogo, pingShopRevalidarSucursales, PING_TIMEOUT_MS } from "@/lib/shop-revalidar"

const fetchMock = vi.fn()

// La fila de `tenants` (shop_url / shop_internal_url) se simula por tenant. Por defecto vacía:
// el tenant cae al par histórico de envs, que es lo que cubren los casos originales.
const filas = new Map<string, { shopUrl: string; shopInternalUrl: string }>()
vi.mock("@/lib/shop-destino-db", () => ({
  leerFilaShop: async (tenantId: string) => filas.get(tenantId) ?? { shopUrl: "", shopInternalUrl: "" },
}))

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  filas.clear()
  vi.stubEnv("SHOP_INTERNAL_URL", "https://shop.test/")
  vi.stubEnv("SHOP_CRM_SECRET", "s3cr3t")
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("pingShopRevalidarSucursales", () => {
  it("POST sin body con Bearer al endpoint de revalidación; 200 → propagado", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://shop.test/api/internal/sucursales/revalidar")
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cr3t")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("502 → no propagado, sin tirar", async () => {
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502 }))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
  })

  it("error de red → no propagado, sin tirar", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
  })

  // La cortina "Próximamente" del Shop (o cualquier intermediario) contesta 200 con HTML: eso NO
  // es un aviso entregado.
  it("200 con HTML (cortina del gate) → no propagado y lo avisa en el log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(
      new Response("<!doctype html><title>Próximamente</title>", { status: 200, headers: { "content-type": "text/html" } }),
    )
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no es el JSON esperado"))
  })

  it("200 con JSON sin ok:true → no propagado", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: false }))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
  })

  it("200 con { ok: true, fetchedAt } → propagado", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, fetchedAt: "2026-09-25T10:00:00.000Z" }))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: true })
  })

  it("timeout de 5 s → no propagado", async () => {
    expect(PING_TIMEOUT_MS).toBe(5000)
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        }),
    )
    const p = pingShopRevalidarSucursales("tenant-a")
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS)
    await expect(p).resolves.toEqual({ propagado: false })
  })

  it("sin SHOP_INTERNAL_URL → no-op (no llama a fetch)", async () => {
    vi.stubEnv("SHOP_INTERNAL_URL", "")
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin SHOP_CRM_SECRET → no-op (no manda un Bearer vacío)", async () => {
    vi.stubEnv("SHOP_CRM_SECRET", "")
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// El wrapper del catálogo comparte todo el cuerpo con el de sucursales (misma función privada) y
// se diferencia en una sola cosa observable: el path. Los casos de arriba siguen tal cual —
// que no haya hecho falta tocarlos es lo que prueba que el refactor no cambió comportamiento.
describe("pingShopRevalidarCatalogo", () => {
  it("pega al endpoint de revalidación del catálogo, no al de sucursales", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(pingShopRevalidarCatalogo("tenant-a")).resolves.toEqual({ propagado: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://shop.test/api/internal/catalogo/revalidar")
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cr3t")
  })

  it("error de red → no propagado, sin tirar", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(pingShopRevalidarCatalogo("tenant-a")).resolves.toEqual({ propagado: false })
  })

  it("502 → no propagado y el warn lleva la etiqueta del catálogo, no la de sucursales", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502 }))
    await expect(pingShopRevalidarCatalogo("tenant-a")).resolves.toEqual({ propagado: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[catalogo]"))
  })

  it("200 con HTML (cortina del gate) → no propagado", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Próximamente</html>", { status: 200, headers: { "content-type": "text/html" } }))
    await expect(pingShopRevalidarCatalogo("tenant-a")).resolves.toEqual({ propagado: false })
  })

  it("sin configuración del Shop → no-op (no llama a fetch)", async () => {
    vi.stubEnv("SHOP_INTERNAL_URL", "")
    await expect(pingShopRevalidarCatalogo("tenant-a")).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("pingShopRevalidarSucursales", () => {
  it("pega al endpoint de sucursales con Bearer y sin body; JSON ok → propagado", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://shop.test/api/internal/sucursales/revalidar")
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cr3t")
  })

  it("best-effort: error de red o 404 (ruta del Shop todavía sin desplegar) no tiran", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
  })

  it("200 con HTML (cortina del gate) → no propagado y el warn lleva la etiqueta", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }))
    await expect(pingShopRevalidarSucursales("tenant-a")).resolves.toEqual({ propagado: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[sucursales]"))
  })
})

describe("ping por tenant", () => {
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 })

  beforeEach(() => {
    filas.set("tenant-a", { shopUrl: "https://a.example", shopInternalUrl: "https://interno-a.example" })
    filas.set("tenant-b", { shopUrl: "https://b.example", shopInternalUrl: "https://interno-b.example" })
    vi.stubEnv("SHOP_CRM_SECRET_TENANT_A", "secreto-a")
    vi.stubEnv("SHOP_CRM_SECRET_TENANT_B", "secreto-b")
  })

  it("va a la URL del tenant con su Bearer", async () => {
    fetchMock.mockImplementation(async () => ok())
    await expect(pingShopRevalidarCatalogo("tenant-a")).resolves.toEqual({ propagado: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://interno-a.example/api/internal/catalogo/revalidar")
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secreto-a")
  })

  it("el ping del tenant A no llega al Shop de B ni lleva su secreto (y viceversa)", async () => {
    fetchMock.mockImplementation(async () => ok())
    await pingShopRevalidarSucursales("tenant-a")
    await pingShopRevalidarCatalogo("tenant-b")

    const llamadas = fetchMock.mock.calls as [string, RequestInit][]
    expect(llamadas).toHaveLength(2)
    const [urlA, initA] = llamadas[0]
    const [urlB, initB] = llamadas[1]
    expect(urlA).toContain("interno-a.example")
    expect(urlA).not.toContain("interno-b.example")
    expect(new Headers(initA.headers).get("authorization")).toBe("Bearer secreto-a")
    expect(urlB).toContain("interno-b.example")
    expect(new Headers(initB.headers).get("authorization")).toBe("Bearer secreto-b")
    // Ni el secreto histórico ni el del otro tenant viajan nunca.
    for (const [, init] of llamadas) expect(new Headers(init.headers).get("authorization")).not.toBe("Bearer s3cr3t")
  })

  it("URL propia sin su secreto: no envía, registra el aviso y no tira (no usa el secreto sin sufijo)", async () => {
    vi.stubEnv("SHOP_CRM_SECRET_TENANT_A", "")
    await expect(pingShopRevalidarCatalogo("tenant-a")).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })

  it("con SHOP_TENANT_LEGACY de otro tenant, un tenant sin URL propia no pega al Shop histórico", async () => {
    vi.stubEnv("SHOP_TENANT_LEGACY", "tenant-a")
    await expect(pingShopRevalidarCatalogo("tenant-sin-shop")).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("un tenant sin URL propia y legacy sin definir sigue pegando al Shop histórico (igual que hoy)", async () => {
    fetchMock.mockImplementation(async () => ok())
    await pingShopRevalidarCatalogo("tenant-sin-shop")
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://shop.test/api/internal/catalogo/revalidar")
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cr3t")
  })
})

// Guarda de tipos: el tenantId es obligatorio. Si alguien lo vuelve opcional, el typecheck falla
// acá (el `@ts-expect-error` sobraría) y los call sites vuelven a poder pegarle al Shop equivocado.
describe("tenantId obligatorio", () => {
  it("no compila sin tenantId", () => {
    const sinTenant = () => {
      // @ts-expect-error falta el tenantId
      void pingShopRevalidarCatalogo()
      // @ts-expect-error falta el tenantId
      void pingShopRevalidarSucursales()
    }
    expect(typeof sinTenant).toBe("function")
  })
})
