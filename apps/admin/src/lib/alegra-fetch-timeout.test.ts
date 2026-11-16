import { afterEach, describe, expect, it, vi } from "vitest"
import { alegraFetch } from "./alegra"
import type { TenantConfig } from "./tenants"

const config = { alegraEmail: "a@cuenta.example", alegraToken: "t", alegraMock: false } as TenantConfig

afterEach(() => vi.unstubAllGlobals())

describe("alegraFetch con timeoutMs", () => {
  it("corta con un error de timeout y NO reintenta (una escritura incierta no se repite)", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(init.signal!.reason))
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const err = await alegraFetch(config, "/bills", undefined, { method: "POST", body: {} }, { timeoutMs: 20 }).catch(
      (e) => e,
    )
    expect(["TimeoutError", "AbortError"]).toContain(err.name)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("sin timeoutMs no agrega señal (comportamiento por defecto intacto)", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify({ ok: true, url, m: init.method }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    await alegraFetch(config, "/items")
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined()
  })

  it("con timeoutMs y respuesta a tiempo devuelve el JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 })))
    await expect(alegraFetch(config, "/bills/1", undefined, undefined, { timeoutMs: 5000 })).resolves.toEqual({ id: 1 })
  })
})
