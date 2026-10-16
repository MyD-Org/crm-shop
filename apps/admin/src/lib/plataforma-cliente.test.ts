import { describe, it, expect, vi } from "vitest"
import { upsertInstancia, leerSpec, PlataformaError, TIMEOUT_MS } from "./plataforma-cliente"
import type { TenantConfig } from "./tenants"

const t = { plataformaUrl: "https://plataforma.example/", plataformaApiKey: "ak_123" } as TenantConfig
const fetchDe = (status: number, body: unknown, capturar?: (url: string, init: RequestInit) => void) =>
  (async (url: string, init: RequestInit) => {
    capturar?.(url, init)
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch

describe("plataforma-cliente", () => {
  it("PATCH by-key con upsert, clave URL-encoded y Bearer", async () => {
    let visto: { url: string; init: RequestInit } | null = null
    const r = await upsertInstancia(
      t,
      "atributos_tecnicos",
      "A/42",
      { data: { ip: { n: 65, t: null } }, meta: { fuente: "pdf" } },
      {
        fetch: fetchDe(201, { instance: {}, created: true, changed: true }, (url, init) => {
          visto = { url, init }
        }),
      },
    )
    expect(r).toEqual({ created: true, changed: true })
    expect(visto!.url).toBe(
      "https://plataforma.example/platform/catalog/instances/atributos_tecnicos/by-key/A%2F42?upsert=true",
    )
    expect(visto!.init.method).toBe("PATCH")
    expect((visto!.init.headers as Record<string, string>).authorization).toBe("Bearer ak_123")
    expect(JSON.parse(visto!.init.body as string)).toEqual({
      data: { ip: { n: 65, t: null } },
      meta: { fuente: "pdf" },
    })
  })

  it("400 invalid_data → PlataformaError no reintentable con details", async () => {
    await expect(
      upsertInstancia(t, "producto", "1", { data: { precio: 1 } }, {
        fetch: fetchDe(400, { error: "invalid_data", details: ["/ must NOT have additional properties (precio)"] }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_data",
      reintentable: false,
      details: ["/ must NOT have additional properties (precio)"],
    } satisfies Partial<PlataformaError>)
  })

  it("503 y error de red → reintentable", async () => {
    await expect(
      upsertInstancia(t, "producto", "1", { data: {} }, { fetch: fetchDe(503, { error: "interceptor_failed" }) }),
    ).rejects.toMatchObject({ status: 503, reintentable: true })
    const red = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    await expect(upsertInstancia(t, "producto", "1", { data: {} }, { fetch: red })).rejects.toMatchObject({
      status: 0,
      code: "red",
      reintentable: true,
    })
  })

  it("leerSpec devuelve el documento", async () => {
    expect(
      await leerSpec(t, "atributos_tecnicos", {
        fetch: fetchDe(200, { spec: { slug: "atributos_tecnicos", version: 1 } }),
      }),
    ).toEqual({ slug: "atributos_tecnicos", version: 1 })
  })

  it("deps.timeoutMs llega a AbortSignal.timeout; sin él se usa TIMEOUT_MS", async () => {
    const espia = vi.spyOn(AbortSignal, "timeout")
    try {
      const f = fetchDe(200, { created: false, changed: false })
      await upsertInstancia(t, "producto", "1", { data: {} }, { fetch: f, timeoutMs: 5_000 })
      expect(espia).toHaveBeenLastCalledWith(5_000)
      await upsertInstancia(t, "producto", "1", { data: {} }, { fetch: f })
      expect(espia).toHaveBeenLastCalledWith(TIMEOUT_MS)
    } finally { espia.mockRestore() }
  })
})
