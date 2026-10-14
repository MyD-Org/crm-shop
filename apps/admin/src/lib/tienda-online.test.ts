import { describe, expect, it } from "vitest"
import fixture from "./__fixtures__/marca-contrato.json"
import temaFixture from "./__fixtures__/tema-contrato.json"
import {
  hostsMedia,
  parseShopMarca,
  parseShopTema,
  COLORES_TEMA,
  parseSitio,
  parseTiendaOnline,
  DESCRIPCION_MAX,
} from "./tienda-online"

/** Expande `{ "$repetir": [caracter, veces] }` del fixture a la cadena larga. */
function expandir(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expandir)
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    if ("$repetir" in o) {
      const [c, n] = o.$repetir as [string, number]
      return c.repeat(n)
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, expandir(x)]))
  }
  return v
}

const ctx = { hosts: fixture.contexto.hosts }

describe("parseShopMarca (fixture marca-contrato.json)", () => {
  it.each(fixture.validos)("válido: $nombre", ({ entrada, salida }) => {
    const r = parseShopMarca(expandir(entrada), ctx)
    expect(r).toEqual({ ok: true, value: expandir(salida) })
  })

  it.each(fixture.invalidos)("inválido: $nombre", ({ entrada, campo }) => {
    const r = parseShopMarca(expandir(entrada), ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.campo).toBe(campo)
      // Errores en usted, listos para mostrar en pantalla: nunca tuteo ni voseo.
      expect(r.error).not.toMatch(/\b(tu|tus|te|vos|ingresá|probá)\b/i)
      expect(r.error.length).toBeGreaterThan(10)
    }
  })

  it("sin hosts de medios configurados no acepta ninguna URL de imagen", () => {
    const r = parseShopMarca({ logoUrl: "https://media.example/logo.svg" }, { hosts: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/almacenamiento/i)
  })

  it("el tope de la descripción es DESCRIPCION_MAX (200)", () => {
    expect(DESCRIPCION_MAX).toBe(200)
  })

  it("la salida es idempotente: volver a validar lo ya validado no cambia nada", () => {
    for (const caso of fixture.validos) {
      const una = parseShopMarca(expandir(caso.entrada), ctx)
      expect(una.ok).toBe(true)
      if (una.ok) expect(parseShopMarca(una.value, ctx)).toEqual(una)
    }
  })
})

describe("parseSitio (shop_url / shop_internal_url)", () => {
  it.each(fixture.sitio.validos)("válido: '$entrada'", ({ entrada, salida }) => {
    expect(parseSitio(entrada, "shopUrl")).toEqual({ ok: true, value: salida })
  })

  it.each(fixture.sitio.invalidos)("inválido: '%s'", (entrada) => {
    const r = parseSitio(entrada, "shopUrl")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.campo).toBe("shopUrl")
  })

  it("rechaza lo que no es texto", () => {
    expect(parseSitio(5, "shopInternalUrl").ok).toBe(false)
  })
})

describe("parseTiendaOnline (cuerpo del PUT)", () => {
  it("junta marca y sitio", () => {
    const r = parseTiendaOnline(
      { marca: { nombre: "Tienda Uno" }, shopUrl: "https://tienda.example/", shopInternalUrl: "" },
      ctx,
    )
    expect(r).toEqual({
      ok: true,
      value: { marca: { nombre: "Tienda Uno" }, shopUrl: "https://tienda.example", shopInternalUrl: "" },
    })
  })

  it("cuerpo vacío o roto = todo vacío (guardar sin cambios no altera nada)", () => {
    expect(parseTiendaOnline({}, ctx)).toEqual({ ok: true, value: { marca: {}, shopUrl: "", shopInternalUrl: "" } })
    expect(parseTiendaOnline(null, ctx).ok).toBe(true)
  })

  it("propaga el primer error", () => {
    const r = parseTiendaOnline({ marca: { base: "x" } }, ctx)
    expect(r.ok).toBe(false)
  })
})

describe("hostsMedia", () => {
  it("une SHOP_MEDIA_HOSTS y el host de R2_SHOP_MEDIA_PUBLIC_URL, sin repetidos", () => {
    expect(
      hostsMedia({
        SHOP_MEDIA_HOSTS: "a.example, b.example ",
        R2_SHOP_MEDIA_PUBLIC_URL: "https://a.example/",
      }),
    ).toEqual(["a.example", "b.example"])
  })
  it("sin variables, lista vacía", () => {
    expect(hostsMedia({})).toEqual([])
  })
  it("ignora una URL pública que no se puede leer", () => {
    expect(hostsMedia({ R2_SHOP_MEDIA_PUBLIC_URL: "nada" })).toEqual([])
  })
})

describe("parseShopTema (fixture tema-contrato.json)", () => {
  it.each(temaFixture.validos)("válido: $nombre", ({ entrada, salida }) => {
    expect(parseShopTema(entrada)).toEqual({ ok: true, value: salida })
  })

  it.each(temaFixture.invalidos)("inválido: $nombre", ({ entrada, campo }) => {
    const r = parseShopTema(entrada)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.campo).toBe(campo)
      expect(r.error).not.toMatch(/\b(tu|tus|te|vos|ingresá|probá)\b/i)
      expect(r.error.length).toBeGreaterThan(10)
    }
  })

  it("la salida es idempotente", () => {
    for (const caso of temaFixture.validos) {
      const una = parseShopTema(caso.entrada)
      expect(una.ok).toBe(true)
      if (una.ok) expect(parseShopTema(una.value)).toEqual(una)
    }
  })

  it("los ocho colores de entrada, con sus nombres", () => {
    expect([...COLORES_TEMA]).toEqual(["bg", "surface", "text", "muted", "primary", "onPrimary", "accent", "surfaceDark"])
  })
})

describe("parseTiendaOnline con tema", () => {
  it("sin la clave tema, el resultado no trae tema (no se pisa lo guardado)", () => {
    const r = parseTiendaOnline({ marca: {} }, ctx)
    expect(r.ok && "tema" in r.value).toBe(false)
  })

  it("con tema, lo valida y lo devuelve", () => {
    const r = parseTiendaOnline({ tema: { base: "calido" } }, ctx)
    expect(r).toMatchObject({ ok: true, value: { tema: { base: "calido" } } })
  })

  it("tema inválido propaga el error", () => {
    expect(parseTiendaOnline({ tema: { base: "x" } }, ctx).ok).toBe(false)
  })
})
