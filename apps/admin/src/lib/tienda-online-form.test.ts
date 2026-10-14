import { describe, expect, it } from "vitest"
import {
  CAMPOS_IMAGEN,
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
    expect(construirPayload(form)).toEqual({ marca: {}, shopUrl: "", shopInternalUrl: "" })
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
