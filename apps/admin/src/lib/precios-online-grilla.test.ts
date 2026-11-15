import { describe, it, expect } from "vitest"
import { parsearQueryGrilla, LIMITE_IDS } from "./precios-online-grilla"
import { MAX_PRODUCTOS_LOTE } from "./precios-online-cambios"

// Parseo de filtros compartido por la grilla y `modo=ids`. Datos inventados.

const url = (q: string) => new URL(`http://admin.example/api/admin/catalogo/precios-online${q}`)

describe("parsearQueryGrilla", () => {
  it("normaliza igual para la grilla y para modo=ids (modo no cambia los filtros)", () => {
    const a = parsearQueryGrilla(url("?marca=%20ACME%20&q=cinta&estado=ok"))
    const b = parsearQueryGrilla(url("?marca=%20ACME%20&q=cinta&estado=ok&modo=ids"))
    expect(a).toMatchObject({ ok: true, filtros: { marca: "acme", q: "cinta", estado: "ok" } })
    expect(b).toEqual(a)
  })
  it("rechaza estado y categoría inválidos", () => {
    expect(parsearQueryGrilla(url("?estado=raro"))).toMatchObject({ ok: false })
    expect(parsearQueryGrilla(url("?categoria=xx"))).toMatchObject({ ok: false })
    expect(parsearQueryGrilla(url("?categoria=sin"))).toMatchObject({ ok: true })
  })
  it("el tope de ids coincide con el de una asignación masiva", () => {
    expect(LIMITE_IDS).toBe(MAX_PRODUCTOS_LOTE)
  })
})
