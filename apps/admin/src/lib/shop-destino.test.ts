import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolverDestinoShop, slugEnvTenant, urlPublicaShop } from "@/lib/shop-destino"

const SIN_FILA = { shopUrl: "", shopInternalUrl: "" }
const filaA = { shopUrl: "https://a.example", shopInternalUrl: "https://interno-a.example/" }
const filaB = { shopUrl: "https://b.example", shopInternalUrl: "https://interno-b.example" }

const LEGACY = {
  SHOP_INTERNAL_URL: "https://legacy-interno.example/",
  SHOP_CRM_SECRET: "secreto-sin-sufijo",
  NEXT_PUBLIC_SHOP_URL: "https://legacy.example/",
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("slugEnvTenant", () => {
  it("mayúsculas y guion bajo en lugar de guion", () => {
    expect(slugEnvTenant("avantec")).toBe("AVANTEC")
    expect(slugEnvTenant("central-led")).toBe("CENTRAL_LED")
  })
})

describe("resolverDestinoShop: tenant con URL propia", () => {
  it("usa la URL interna de la fila y SHOP_CRM_SECRET_<SLUG>", () => {
    const env = { ...LEGACY, SHOP_CRM_SECRET_TENANT_A: "secreto-a" }
    expect(resolverDestinoShop("tenant-a", filaA, env)).toEqual({
      urlInterna: "https://interno-a.example",
      urlPublica: "https://a.example",
      secret: "secreto-a",
    })
  })

  it("sin secreto con sufijo devuelve null y avisa: NUNCA cae al secreto sin sufijo", () => {
    const env = { ...LEGACY } // hay SHOP_CRM_SECRET pero no SHOP_CRM_SECRET_TENANT_A
    expect(resolverDestinoShop("tenant-a", filaA, env)).toBeNull()
    expect(console.warn).toHaveBeenCalled()
  })

  it("un secreto con sufijo vacío o en blanco cuenta como ausente", () => {
    expect(resolverDestinoShop("tenant-a", filaA, { ...LEGACY, SHOP_CRM_SECRET_TENANT_A: "  " })).toBeNull()
  })

  it("con SHOP_TENANT_LEGACY igual al tenant sigue sin usar el secreto sin sufijo", () => {
    const env = { ...LEGACY, SHOP_TENANT_LEGACY: "tenant-a" }
    expect(resolverDestinoShop("tenant-a", filaA, env)).toBeNull()
  })

  it("solo shop_url (sin interna): el ping va a esa URL, con el secreto con sufijo", () => {
    const env = { SHOP_CRM_SECRET_TENANT_A: "secreto-a" }
    expect(resolverDestinoShop("tenant-a", { shopUrl: "https://a.example/", shopInternalUrl: "" }, env)).toEqual({
      urlInterna: "https://a.example",
      urlPublica: "https://a.example",
      secret: "secreto-a",
    })
  })

  it("dos tenants no se cruzan: cada uno obtiene su URL y su secreto", () => {
    const env = { ...LEGACY, SHOP_CRM_SECRET_TENANT_A: "secreto-a", SHOP_CRM_SECRET_TENANT_B: "secreto-b" }
    const a = resolverDestinoShop("tenant-a", filaA, env)
    const b = resolverDestinoShop("tenant-b", filaB, env)
    expect(a?.secret).toBe("secreto-a")
    expect(b?.secret).toBe("secreto-b")
    expect(a?.urlInterna).not.toBe(b?.urlInterna)
    expect(JSON.stringify(a)).not.toContain("secreto-b")
    expect(JSON.stringify(b)).not.toContain("secreto-a")
  })

  it("el slug con guion usa guion bajo en la env", () => {
    const env = { SHOP_CRM_SECRET_CENTRAL_LED: "s" }
    expect(resolverDestinoShop("central-led", filaA, env)?.secret).toBe("s")
  })
})

describe("resolverDestinoShop: tenant sin URL propia (legacy)", () => {
  it("SHOP_TENANT_LEGACY sin definir: par histórico, igual que antes", () => {
    expect(resolverDestinoShop("tenant-a", SIN_FILA, LEGACY)).toEqual({
      urlInterna: "https://legacy-interno.example",
      urlPublica: "https://legacy.example",
      secret: "secreto-sin-sufijo",
    })
  })

  it("SHOP_TENANT_LEGACY vacío cuenta como sin definir", () => {
    expect(resolverDestinoShop("tenant-a", SIN_FILA, { ...LEGACY, SHOP_TENANT_LEGACY: "" })).not.toBeNull()
  })

  it("SHOP_TENANT_LEGACY igual al tenant: par histórico", () => {
    const r = resolverDestinoShop("tenant-a", SIN_FILA, { ...LEGACY, SHOP_TENANT_LEGACY: "tenant-a" })
    expect(r?.secret).toBe("secreto-sin-sufijo")
  })

  it("SHOP_TENANT_LEGACY distinto: null (el ping de otro tenant no va al Shop legacy)", () => {
    expect(resolverDestinoShop("tenant-b", SIN_FILA, { ...LEGACY, SHOP_TENANT_LEGACY: "tenant-a" })).toBeNull()
  })

  it("sin envs históricas: destino con todo null (no-op de hoy)", () => {
    expect(resolverDestinoShop("tenant-a", SIN_FILA, {})).toEqual({ urlInterna: null, urlPublica: null, secret: null })
  })
})

describe("urlPublicaShop", () => {
  it("URL propia: la de la fila, aunque falte el secreto", () => {
    expect(urlPublicaShop("tenant-a", filaA, LEGACY)).toBe("https://a.example")
  })
  it("URL propia sin shop_url pública: null (no cae a la del legacy)", () => {
    expect(urlPublicaShop("tenant-a", { shopUrl: "", shopInternalUrl: "https://i.example" }, LEGACY)).toBeNull()
  })
  it("sin URL propia: NEXT_PUBLIC_SHOP_URL solo si el legacy es de este tenant o no está definido", () => {
    expect(urlPublicaShop("tenant-a", SIN_FILA, LEGACY)).toBe("https://legacy.example")
    expect(urlPublicaShop("tenant-b", SIN_FILA, { ...LEGACY, SHOP_TENANT_LEGACY: "tenant-a" })).toBeNull()
  })
})
