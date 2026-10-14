import { describe, expect, it } from "vitest"
import temaFixture from "./__fixtures__/tema-contrato.json"
import {
  CAMPOS_IMAGEN,
  PALETAS_TEMA,
  avisoContrasteForm,
  construirPayload,
  extensionDeArchivo,
  formDesdeDatos,
  formVacio,
  mensajeSubida,
} from "./tienda-online-form"

describe("formDesdeDatos / construirPayload", () => {
  it("'{}' y direcciones vacías → formulario vacío → payload vacío (guardar sin cambios no altera nada)", () => {
    const form = formDesdeDatos({ marca: {}, shopUrl: "", shopInternalUrl: "" })
    expect(form).toEqual(formVacio())
    expect(construirPayload(form)).toEqual({ marca: {}, shopUrl: "", shopInternalUrl: "", tema: {} })
  })

  it("ida y vuelta sin pérdida", () => {
    const datos = {
      marca: {
        base: "generica" as const,
        nombre: "Tienda Uno",
        titulo: "Tienda Uno — Online",
        descripcion: "Descripción",
        logoUrl: "https://media.example/marca/t/a.svg",
        logoMailUrl: "https://media.example/marca/t/b.png",
        faviconUrl: "https://media.example/marca/t/c.png",
        ogImagenUrl: "https://media.example/marca/t/d.webp",
        ogTextos: { eyebrow: "Tienda", bajada: "Bajada", lugar: "Ciudad" },
        emailContacto: "ventas@tienda.example",
      },
      shopUrl: "https://tienda.example",
      shopInternalUrl: "https://interna.example",
      tema: { base: "calido" as const, colores: PALETAS_TEMA["calido"] },
    }
    expect(construirPayload(formDesdeDatos(datos))).toEqual(datos)
  })

  it("los campos en blanco no viajan (el servidor los trataría como ausentes igual)", () => {
    const form = { ...formVacio(), nombre: "  ", ogEyebrow: "" }
    expect(construirPayload(form).marca).toEqual({})
  })

  it("tolera datos faltantes o de forma inesperada", () => {
    expect(formDesdeDatos({ marca: null, shopUrl: null, shopInternalUrl: undefined } as never)).toEqual(formVacio())
  })

  it("lista los cuatro campos de imagen", () => {
    expect([...CAMPOS_IMAGEN]).toEqual(["logoUrl", "logoMailUrl", "faviconUrl", "ogImagenUrl"])
  })
})

describe("tema en el formulario", () => {
  it("las paletas de partida son las del fixture compartido", () => {
    expect(PALETAS_TEMA).toEqual(temaFixture.paletas)
  })

  it("sin tema guardado: colores de partida precargados, sin 'personalizar'; el payload manda tema vacío", () => {
    const f = formDesdeDatos({ marca: {}, shopUrl: "", shopInternalUrl: "" })
    expect(f.temaPropio).toBe(false)
    expect(f.temaBase).toBe("calido-azul")
    expect(f.colores).toEqual(PALETAS_TEMA["calido-azul"])
    expect(construirPayload(f).tema).toEqual({})
  })

  it("con colores guardados el formulario los muestra y marca 'personalizar'", () => {
    const colores = { ...PALETAS_TEMA["calido-azul"], accent: "#2255aa" }
    const f = formDesdeDatos({ marca: {}, shopUrl: "", shopInternalUrl: "", tema: { colores } })
    expect(f.temaPropio).toBe(true)
    expect(f.colores.accent).toBe("#2255aa")
    expect(construirPayload(f).tema).toEqual({ colores })
  })

  it("solo base distinta de la de partida: viaja la base y no los colores", () => {
    const f = { ...formVacio(), temaBase: "calido" as const }
    expect(construirPayload(f).tema).toEqual({ base: "calido" })
  })

  it("desactivar 'personalizar' descarta los colores del payload", () => {
    const f = { ...formVacio(), temaPropio: false, colores: { ...PALETAS_TEMA["calido-azul"], accent: "#2255aa" } }
    expect(construirPayload(f).tema).toEqual({})
  })

  it("los hex se recortan; el servidor los normaliza", () => {
    const f = { ...formVacio(), temaPropio: true, colores: { ...PALETAS_TEMA["calido-azul"], bg: " #F8F8F6 " } }
    expect(construirPayload(f).tema?.colores?.bg).toBe("#F8F8F6")
  })

  it("avisoContrasteForm: null si no se personaliza o la paleta es legible; mensaje si no", () => {
    expect(avisoContrasteForm(formVacio())).toBeNull()
    const ok = { ...formVacio(), temaPropio: true }
    expect(avisoContrasteForm(ok)).toBeNull()
    const mal = { ...ok, colores: { ...PALETAS_TEMA["calido-azul"], text: "#f0f0ee" } }
    expect(avisoContrasteForm(mal)).toMatchObject({ campo: "text" })
  })

  it("avisoContrasteForm no opina mientras algún color no es un hex completo", () => {
    const f = { ...formVacio(), temaPropio: true, colores: { ...PALETAS_TEMA["calido-azul"], text: "#1c27" } }
    expect(avisoContrasteForm(f)).toBeNull()
  })
})

describe("extensionDeArchivo", () => {
  it.each([
    ["logo.SVG", "image/svg+xml", "svg"],
    ["logo.png", "image/png", "png"],
    ["foto.jpeg", "image/jpeg", "jpg"],
    ["foto.jpg", "", "jpg"],
    ["logo.webp", "image/webp", "webp"],
    ["sin-extension", "image/png", "png"],
    ["raro.bin", "image/webp", "webp"],
  ])("%s (%s) → %s", (nombre, tipo, ext) => {
    expect(extensionDeArchivo(nombre, tipo)).toBe(ext)
  })

  it("formatos no permitidos → null", () => {
    expect(extensionDeArchivo("a.gif", "image/gif")).toBeNull()
    expect(extensionDeArchivo("a.pdf", "application/pdf")).toBeNull()
    expect(extensionDeArchivo("a", "")).toBeNull()
  })
})

describe("mensajeSubida", () => {
  it("usa el error del servidor y, si no hay, un mensaje en usted", () => {
    expect(mensajeSubida({ error: "Algo salió mal" })).toBe("Algo salió mal")
    const generico = mensajeSubida(null)
    expect(generico).toMatch(/Inténtelo/)
    expect(generico).not.toMatch(/\b(tu|vos|probá)\b/i)
  })
})
