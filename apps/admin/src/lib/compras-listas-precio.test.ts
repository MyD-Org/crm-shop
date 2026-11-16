import { describe, expect, it } from "vitest"
import type { AlegraPriceList } from "./alegra"
import { aplicarPreciosElegidos, listasConAjuste, listasConDefecto, porcentajeDesdePrecio, precioDesdePorcentaje } from "./compras-listas-precio"

const lista = (alegraId: string, name: string, status = "active"): AlegraPriceList => ({ alegraId, name, type: null, status })
const CUENTA = [lista("1", "General"), lista("7", "L1"), lista("8", "Lista 2"), lista("9", "L5"), lista("10", "PROMOCIÓN EFECTIVO"), lista("11", "Vieja", "inactive")]

describe("listas de precio del alta", () => {
  it("calcula precio sin IVA con 2 decimales", () => {
    expect(precioDesdePorcentaje(100, 60)).toBe(160)
    expect(precioDesdePorcentaje(33.33, 25)).toBe(41.66)
    expect(porcentajeDesdePrecio(100, 140)).toBe(40)
  })

  it("resuelve los ids de la cuenta y el % por defecto por nombre; ignora las inactivas", () => {
    const r = listasConDefecto(CUENTA, 100, "Mar del Plata")
    expect(r.ok && r.listas.map((l) => [l.id, l.porcentajeDefecto, l.precio])).toEqual([
      ["1", 60, 160],
      ["7", 60, 160],
      ["8", 40, 140],
      ["9", 25, 125],
      ["10", 30, 130],
    ])
  })

  it("bloquea (en usted) si una lista activa no tiene coeficiente", () => {
    const r = listasConDefecto([...CUENTA, lista("12", "Mayorista VIP")], 100, "Mar del Plata")
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain("Mayorista VIP")
    expect(!r.ok && r.error).toContain("Defina")
  })

  it("al elegir precios deriva el % y exige todas las listas", () => {
    const completo = CUENTA.slice(0, 5).map((l) => ({ id: l.alegraId, precio: 200 }))
    const r = aplicarPreciosElegidos(CUENTA, 100, completo, "MDP")
    expect(r.ok && r.listas.every((l) => l.porcentaje === 100)).toBe(true)
    expect(aplicarPreciosElegidos(CUENTA, 100, completo.slice(1), "MDP").ok).toBe(false)
    expect(aplicarPreciosElegidos(CUENTA, 100, [{ id: "1", precio: 0 }, ...completo.slice(1)], "MDP").ok).toBe(false)
  })

  it("sólo las listas con % distinto del por defecto son ajuste", () => {
    const defecto: Record<string, number> = { "1": 160, "7": 160, "8": 150, "9": 125, "10": 130 }
    const elegidos = Object.entries(defecto).map(([id, precio]) => ({ id, precio }))
    const r = aplicarPreciosElegidos(CUENTA, 100, elegidos, "MDP")
    expect(r.ok && listasConAjuste(r.listas).map((l) => [l.id, l.porcentaje])).toEqual([["8", 50]])
  })
})
