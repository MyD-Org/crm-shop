import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  MAX_DESTINOS_EXTRA,
  nombreSecretoExtra,
  parsearDestinosExtra,
  resolverDestinoShop,
  resolverDestinosShop,
  slugEnvTenant,
  urlPublicaShop,
  urlPublicaShopParaPedido,
  urlsPublicasShop,
} from "@/lib/shop-destino"

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

describe("parsearDestinosExtra", () => {
  const item = (o: Record<string, unknown> = {}) => ({ etiqueta: "tienda-b", url: "https://tienda-b.example", ...o })

  it("lo que no es un array da lista vacía, sin tirar", () => {
    for (const raw of [null, undefined, {}, "x", 7, { etiqueta: "a" }]) {
      expect(parsearDestinosExtra(raw)).toEqual({ validos: [], descartados: [] })
    }
  })

  it("un ítem válido: urlInterna por defecto = url", () => {
    expect(parsearDestinosExtra([item()])).toEqual({
      validos: [{ etiqueta: "tienda-b", url: "https://tienda-b.example", urlInterna: "https://tienda-b.example" }],
      descartados: [],
    })
  })

  it("marca, tema y remitente del sitio se conservan (marca por dominio)", () => {
    const marca = { base: "generica", nombre: "Tienda B" }
    const tema = { base: "calido" }
    const r = parsearDestinosExtra([item({ marca, tema, remitente: " pedidos@tienda-b.example " })])
    expect(r.validos[0]).toEqual({
      etiqueta: "tienda-b",
      url: "https://tienda-b.example",
      urlInterna: "https://tienda-b.example",
      marca,
      tema,
      remitente: "pedidos@tienda-b.example",
    })
  })

  it("destino legado sin marca ni tema: sin esas claves (alias del principal)", () => {
    const v = parsearDestinosExtra([item()]).validos[0]
    expect("marca" in v || "tema" in v || "remitente" in v).toBe(false)
  })

  it("marca o tema que no son objeto y remitente inválido se ignoran sin descartar el destino", () => {
    const r = parsearDestinosExtra([item({ marca: "x", tema: [1], remitente: "no-es-mail" })])
    expect(r.descartados).toEqual([])
    expect(r.validos[0]).toEqual({ etiqueta: "tienda-b", url: "https://tienda-b.example", urlInterna: "https://tienda-b.example" })
  })

  it("urlInterna propia se respeta y se normaliza", () => {
    const r = parsearDestinosExtra([item({ urlInterna: "https://interno-b.example/" })])
    expect(r.validos[0].urlInterna).toBe("https://interno-b.example")
  })

  it("un ítem inválido se descarta sin tirar la lista", () => {
    const r = parsearDestinosExtra([null, item({ etiqueta: "otra", url: "" }), item({ etiqueta: "buena", url: "https://buena.example" })])
    expect(r.validos.map((v) => v.etiqueta)).toEqual(["buena"])
    expect(r.descartados).toEqual(["#0", "otra"])
  })

  it("etiqueta: reservada, con guion bajo, mayúsculas, >24 o vacía se descartan", () => {
    const r = parsearDestinosExtra([
      item({ etiqueta: "principal" }),
      item({ etiqueta: "tienda_b" }),
      item({ etiqueta: "Tienda-B" }),
      item({ etiqueta: "a".repeat(25) }),
      item({ etiqueta: "" }),
      item({ etiqueta: "-x" }),
    ])
    expect(r.validos).toEqual([])
    expect(r.descartados).toHaveLength(6)
  })

  it("etiqueta de 24 caracteres es válida", () => {
    expect(parsearDestinosExtra([item({ etiqueta: "a".repeat(24) })]).validos).toHaveLength(1)
  })

  it("etiqueta duplicada: se conserva solo la primera", () => {
    const r = parsearDestinosExtra([item(), item({ url: "https://otra.example" })])
    expect(r.validos).toHaveLength(1)
    expect(r.validos[0].url).toBe("https://tienda-b.example")
    expect(r.descartados).toEqual(["tienda-b"])
  })

  it("url http fuera de localhost se descarta; en localhost se acepta", () => {
    expect(parsearDestinosExtra([item({ url: "http://tienda-b.example" })]).validos).toEqual([])
    expect(parsearDestinosExtra([item({ url: "http://localhost:3001" })]).validos[0].url).toBe("http://localhost:3001")
    expect(parsearDestinosExtra([item({ url: "http://127.0.0.1:3001" })]).validos).toHaveLength(1)
    expect(parsearDestinosExtra([item({ url: "http://tienda.localhost:3001" })]).validos).toHaveLength(1)
  })

  it("url con credenciales o de otro protocolo se descarta", () => {
    expect(parsearDestinosExtra([item({ url: "https://user:pass@tienda-b.example" })]).validos).toEqual([])
    expect(parsearDestinosExtra([item({ url: "ftp://tienda-b.example" })]).validos).toEqual([])
    expect(parsearDestinosExtra([item({ url: "no es una url" })]).validos).toEqual([])
  })

  it("url con path/query se reduce al origin", () => {
    expect(parsearDestinosExtra([item({ url: "https://Tienda-B.example/algo?x=1#h" })]).validos[0].url).toBe("https://tienda-b.example")
  })

  it("urlInterna informada pero inválida descarta el ítem (no cae a la url)", () => {
    const r = parsearDestinosExtra([item({ urlInterna: "http://interno-b.example" })])
    expect(r.validos).toEqual([])
    expect(r.descartados).toEqual(["tienda-b"])
  })

  it("url duplicada de otro extra o del principal se descarta", () => {
    const r = parsearDestinosExtra(
      [item({ etiqueta: "uno", url: "https://uno.example" }), item({ etiqueta: "dos", url: "https://uno.example/otra" }), item({ etiqueta: "tres", url: "https://principal.example" })],
      ["https://principal.example/"],
    )
    expect(r.validos.map((v) => v.etiqueta)).toEqual(["uno"])
    expect(r.descartados).toEqual(["dos", "tres"])
  })

  it(`más de ${MAX_DESTINOS_EXTRA} extras: se descarta el resto`, () => {
    const raw = Array.from({ length: 6 }, (_, i) => item({ etiqueta: `t${i}`, url: `https://t${i}.example` }))
    const r = parsearDestinosExtra(raw)
    expect(MAX_DESTINOS_EXTRA).toBe(4)
    expect(r.validos.map((v) => v.etiqueta)).toEqual(["t0", "t1", "t2", "t3"])
    expect(r.descartados).toEqual(["t4", "t5"])
  })
})

describe("nombreSecretoExtra", () => {
  it("SHOP_CRM_SECRET_<TENANT>__<ETIQUETA> con guion bajo y mayúsculas", () => {
    expect(nombreSecretoExtra("central-led", "tienda-b")).toBe("SHOP_CRM_SECRET_CENTRAL_LED__TIENDA_B")
    expect(nombreSecretoExtra("tenant-a", "b")).toBe("SHOP_CRM_SECRET_TENANT_A__B")
  })
})

describe("resolverDestinosShop", () => {
  const extras = [{ etiqueta: "tienda-b", url: "https://tienda-b.example", urlInterna: "https://interno-b.example" }]
  const filaConExtras = { ...filaA, shopDestinosExtra: extras }
  const envBase = { SHOP_CRM_SECRET_TENANT_A: "secreto-a", SHOP_CRM_SECRET_TENANT_A__TIENDA_B: "secreto-b" }

  it("sin extras: solo el principal, igual que resolverDestinoShop", () => {
    const r = resolverDestinosShop("tenant-a", filaA, envBase)
    expect(r.omitidos).toEqual([])
    expect(r.destinos).toEqual([{ ...resolverDestinoShop("tenant-a", filaA, envBase)!, etiqueta: "principal" }])
  })

  it("shopDestinosExtra [] o ausente da lo mismo", () => {
    expect(resolverDestinosShop("tenant-a", { ...filaA, shopDestinosExtra: [] }, envBase)).toEqual(resolverDestinosShop("tenant-a", filaA, envBase))
  })

  it("principal + extra, cada uno con su URL y su secreto", () => {
    const r = resolverDestinosShop("tenant-a", filaConExtras, envBase)
    expect(r.omitidos).toEqual([])
    expect(r.destinos.map((d) => [d.etiqueta, d.urlInterna, d.secret])).toEqual([
      ["principal", "https://interno-a.example", "secreto-a"],
      ["tienda-b", "https://interno-b.example", "secreto-b"],
    ])
  })

  it("extra sin secreto (o en blanco): omitido y NO cae a ningún otro secreto", () => {
    const env = { ...LEGACY, SHOP_CRM_SECRET_TENANT_A: "secreto-a" }
    for (const e of [env, { ...env, SHOP_CRM_SECRET_TENANT_A__TIENDA_B: "  " }]) {
      const r = resolverDestinosShop("tenant-a", filaConExtras, e)
      expect(r.destinos.map((d) => d.etiqueta)).toEqual(["principal"])
      expect(r.omitidos).toEqual(["tienda-b"])
      expect(JSON.stringify(r.destinos)).not.toContain("secreto-sin-sufijo")
    }
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SHOP_CRM_SECRET_TENANT_A__TIENDA_B"))
  })

  it("el warn nombra la env pero nunca imprime un valor", () => {
    resolverDestinosShop("tenant-a", filaConExtras, { SHOP_CRM_SECRET_TENANT_A: "secreto-a" })
    const log = JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls)
    expect(log).not.toContain("secreto-a")
  })

  it("extra con url vacía o no https: omitido, el resto sigue", () => {
    const fila = { ...filaA, shopDestinosExtra: [{ etiqueta: "roto", url: "" }, { etiqueta: "http", url: "http://x.example" }, ...extras] }
    const r = resolverDestinosShop("tenant-a", fila, envBase)
    expect(r.destinos.map((d) => d.etiqueta)).toEqual(["principal", "tienda-b"])
    expect(r.omitidos).toEqual(["roto", "http"])
  })

  it("jsonb inválido: se conserva el principal sin tirar", () => {
    const r = resolverDestinosShop("tenant-a", { ...filaA, shopDestinosExtra: { no: "array" } }, envBase)
    expect(r.destinos.map((d) => d.etiqueta)).toEqual(["principal"])
    expect(r.omitidos).toEqual([])
  })

  it("principal con URL propia pero sin secreto: va a omitidos y el extra igual se resuelve", () => {
    const r = resolverDestinosShop("tenant-a", filaConExtras, { SHOP_CRM_SECRET_TENANT_A__TIENDA_B: "secreto-b" })
    expect(r.destinos.map((d) => d.etiqueta)).toEqual(["tienda-b"])
    expect(r.omitidos).toEqual(["principal"])
  })

  it("extras ignorados si el principal no tiene URL propia (par histórico)", () => {
    const r = resolverDestinosShop("tenant-a", { ...SIN_FILA, shopDestinosExtra: extras }, { ...LEGACY, ...envBase })
    expect(r.destinos.map((d) => d.etiqueta)).toEqual(["principal"])
    expect(r.destinos[0].secret).toBe("secreto-sin-sufijo")
    expect(r.omitidos).toEqual([])
  })

  it("sin URL propia ni legacy: nada, y 'principal' no figura como omitido", () => {
    const r = resolverDestinosShop("tenant-a", SIN_FILA, {})
    expect(r).toEqual({ destinos: [], omitidos: [] })
  })

  it("un extra no se mezcla con el secreto de otro tenant", () => {
    const r = resolverDestinosShop("tenant-a", filaConExtras, { ...envBase, SHOP_CRM_SECRET_TENANT_B__TIENDA_B: "secreto-ajeno" })
    expect(JSON.stringify(r)).not.toContain("secreto-ajeno")
  })
})

describe("urlsPublicasShop / urlPublicaShopParaPedido", () => {
  const tenant = {
    id: "tenant-b",
    shopUrl: "https://b.example/",
    shopInternalUrl: "",
    shopDestinosExtra: [
      { etiqueta: "otro", url: "https://tienda-b.example/" },
      { etiqueta: "malo", url: "http://inseguro.example" },
    ],
  }

  it("urlsPublicasShop: principal + extras válidos, normalizados", () => {
    expect(urlsPublicasShop(tenant, {})).toEqual(["https://b.example", "https://tienda-b.example"])
  })

  it("sitio del extra → la URL configurada del extra", () => {
    expect(urlPublicaShopParaPedido(tenant, "https://tienda-b.example", {})).toBe("https://tienda-b.example")
  })

  it("sitio del principal → el principal", () => {
    expect(urlPublicaShopParaPedido(tenant, "https://b.example", {})).toBe("https://b.example")
  })

  it("NULL, desconocido o inválido → el principal", () => {
    expect(urlPublicaShopParaPedido(tenant, null, {})).toBe("https://b.example")
    expect(urlPublicaShopParaPedido(tenant, undefined, {})).toBe("https://b.example")
    expect(urlPublicaShopParaPedido(tenant, "https://ajeno.example", {})).toBe("https://b.example")
    expect(urlPublicaShopParaPedido(tenant, "no es una url", {})).toBe("https://b.example")
    expect(urlPublicaShopParaPedido(tenant, "http://inseguro.example", {})).toBe("https://b.example")
  })

  it("nunca devuelve el string crudo guardado (path, mayúsculas)", () => {
    expect(urlPublicaShopParaPedido(tenant, "https://TIENDA-B.example/x?y=1", {})).toBe("https://tienda-b.example")
  })

  it("tenant sin URL propia: extras ignorados, rige el legado", () => {
    const sin = { id: "tenant-a", shopDestinosExtra: [{ etiqueta: "otro", url: "https://tienda-b.example" }] }
    expect(urlPublicaShopParaPedido(sin, "https://tienda-b.example", { NEXT_PUBLIC_SHOP_URL: "https://legacy.example/" })).toBe(
      "https://legacy.example",
    )
  })

  it("sin ninguna URL → null", () => {
    expect(urlPublicaShopParaPedido({ id: "x" }, "https://tienda-b.example", { SHOP_TENANT_LEGACY: "otro" })).toBeNull()
  })
})
