import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { pingShopRevalidarCatalogo, pingShopRevalidarCuotas, PING_TIMEOUT_MS } from "@/lib/shop-revalidar"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
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

describe("pingShopRevalidarCuotas", () => {
  it("POST sin body con Bearer al endpoint de revalidación; 200 → propagado", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://shop.test/api/internal/cuotas/revalidar")
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cr3t")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("502 → no propagado, sin tirar", async () => {
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502 }))
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: false })
  })

  it("error de red → no propagado, sin tirar", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: false })
  })

  // La cortina "Próximamente" del Shop (o cualquier intermediario) contesta 200 con HTML: eso NO
  // es un aviso entregado.
  it("200 con HTML (cortina del gate) → no propagado y lo avisa en el log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(
      new Response("<!doctype html><title>Próximamente</title>", { status: 200, headers: { "content-type": "text/html" } }),
    )
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no es el JSON esperado"))
  })

  it("200 con JSON sin ok:true → no propagado", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: false }))
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: false })
  })

  it("200 con { ok: true, fetchedAt } (respuesta de cuotas) → propagado", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, fetchedAt: "2026-09-25T10:00:00.000Z" }))
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: true })
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
    const p = pingShopRevalidarCuotas()
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS)
    await expect(p).resolves.toEqual({ propagado: false })
  })

  it("sin SHOP_INTERNAL_URL → no-op (no llama a fetch)", async () => {
    vi.stubEnv("SHOP_INTERNAL_URL", "")
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin SHOP_CRM_SECRET → no-op (no manda un Bearer vacío)", async () => {
    vi.stubEnv("SHOP_CRM_SECRET", "")
    await expect(pingShopRevalidarCuotas()).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// El wrapper del catálogo comparte todo el cuerpo con el de cuotas (misma función privada) y
// se diferencia en una sola cosa observable: el path. Los casos de arriba siguen tal cual —
// que no haya hecho falta tocarlos es lo que prueba que el refactor no cambió comportamiento.
describe("pingShopRevalidarCatalogo", () => {
  it("pega al endpoint de revalidación del catálogo, no al de cuotas", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(pingShopRevalidarCatalogo()).resolves.toEqual({ propagado: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://shop.test/api/internal/catalogo/revalidar")
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cr3t")
  })

  it("error de red → no propagado, sin tirar", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(pingShopRevalidarCatalogo()).resolves.toEqual({ propagado: false })
  })

  it("502 → no propagado y el warn lleva la etiqueta del catálogo, no la de cuotas", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502 }))
    await expect(pingShopRevalidarCatalogo()).resolves.toEqual({ propagado: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[catalogo]"))
  })

  it("200 con HTML (cortina del gate) → no propagado", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Próximamente</html>", { status: 200, headers: { "content-type": "text/html" } }))
    await expect(pingShopRevalidarCatalogo()).resolves.toEqual({ propagado: false })
  })

  it("sin configuración del Shop → no-op (no llama a fetch)", async () => {
    vi.stubEnv("SHOP_INTERNAL_URL", "")
    await expect(pingShopRevalidarCatalogo()).resolves.toEqual({ propagado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
