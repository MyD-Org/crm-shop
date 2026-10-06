import { describe, expect, it } from "vitest"
import { costoDeItem } from "./alegra"

// El costo unitario sale de raw.inventory.unitCost (Alegra, GET /items?fields=inventory).
// Solo vale un número finito > 0; todo lo demás es "sin costo" (null), nunca 0.

describe("costoDeItem", () => {
  it.each([
    ["numérico", { inventory: { unitCost: 100 } }, 100],
    ["decimal", { inventory: { unitCost: 33.33 } }, 33.33],
    ["string numérico", { inventory: { unitCost: "250.5" } }, 250.5],
    ["cero", { inventory: { unitCost: 0 } }, null],
    ["string cero", { inventory: { unitCost: "0" } }, null],
    ["null", { inventory: { unitCost: null } }, null],
    ["ausente", { inventory: {} }, null],
    ["sin inventory", {}, null],
    ["inventory no objeto", { inventory: "x" }, null],
    ["negativo", { inventory: { unitCost: -5 } }, null],
    ["NaN", { inventory: { unitCost: Number.NaN } }, null],
    ["Infinity", { inventory: { unitCost: Number.POSITIVE_INFINITY } }, null],
    ["string vacío", { inventory: { unitCost: "" } }, null],
    ["string no numérico", { inventory: { unitCost: "abc" } }, null],
    ["booleano", { inventory: { unitCost: true } }, null],
  ])("%s", (_n, raw, esperado) => {
    expect(costoDeItem(raw as Record<string, unknown>)).toBe(esperado)
  })
})
