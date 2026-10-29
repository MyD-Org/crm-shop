import { describe, expect, it } from "vitest"
import { parsearQueryListado, parsearSeleccion } from "./catalogo-admin"

describe("filtro por marca", () => {
  it("parsea ?marca= y la conserva en la selección por filtro", () => {
    const r = parsearQueryListado(new URL("http://interno/?marca=marca%20a"))
    expect(r).toMatchObject({ filtros: { marca: "marca a" } })
    expect(parsearSeleccion({ seleccion: { tipo: "filtro", filtros: { marca: "marca a" } } })).toMatchObject({
      filtros: { marca: "marca a" },
    })
  })

  it("rechaza una marca de más de 100 caracteres con 400", async () => {
    const r = parsearQueryListado(new URL(`http://interno/?marca=${"x".repeat(101)}`))
    expect(r).toBeInstanceOf(Response)
    const res = r as Response
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "El filtro de marca es inválido", campo: "marca" })
  })

  it("rechaza una marca vacía o sólo de espacios", () => {
    expect(parsearQueryListado(new URL("http://interno/?marca="))).toBeInstanceOf(Response)
    expect(parsearQueryListado(new URL("http://interno/?marca=%20%20"))).toBeInstanceOf(Response)
  })
})
