import { describe, expect, it } from "vitest"
import {
  AVISO_SIN_CANALES,
  badgeCanales,
  canalesFormDesde,
  canalesPayload,
  canalesSinGuardar,
  avisoCanales,
} from "@/lib/canales-form"

describe("canalesFormDesde / canalesPayload", () => {
  it("NULL → modo todos; enviar todos manda null", () => {
    const f = canalesFormDesde(null)
    expect(f).toEqual({ modo: "todos", seleccion: [] })
    expect(canalesPayload(f)).toBeNull()
  })
  it("una lista → modo selección; el payload es esa lista", () => {
    const f = canalesFormDesde(["canal-a"])
    expect(f).toEqual({ modo: "seleccion", seleccion: ["canal-a"] })
    expect(canalesPayload(f)).toEqual(["canal-a"])
  })
  it("lista vacía → modo selección sin nada: payload [] (no null)", () => {
    const f = canalesFormDesde([])
    expect(f.modo).toBe("seleccion")
    expect(canalesPayload(f)).toEqual([])
  })
  it("pasar a todos descarta la selección que había", () => {
    expect(canalesPayload({ modo: "todos", seleccion: ["canal-a"] })).toBeNull()
  })
})

describe("avisoCanales", () => {
  it("avisa (en usted) solo con modo selección y nada tildado", () => {
    expect(avisoCanales({ modo: "seleccion", seleccion: [] })).toBe(AVISO_SIN_CANALES)
    expect(AVISO_SIN_CANALES).toBe("Este usuario no podrá ver ninguna conversación.")
    expect(avisoCanales({ modo: "seleccion", seleccion: ["a"] })).toBeNull()
    expect(avisoCanales({ modo: "todos", seleccion: [] })).toBeNull()
  })
})

describe("badgeCanales", () => {
  it("Todos / N canales / Sin canales", () => {
    expect(badgeCanales(null)).toBe("Todos")
    expect(badgeCanales([])).toBe("Sin canales")
    expect(badgeCanales(["a"])).toBe("1 canal")
    expect(badgeCanales(["a", "b"])).toBe("2 canales")
  })
})

describe("canalesSinGuardar", () => {
  it("compara por conjunto, ignorando el orden", () => {
    expect(canalesSinGuardar(["a", "b"], { modo: "seleccion", seleccion: ["b", "a"] })).toBe(false)
    expect(canalesSinGuardar(["a"], { modo: "seleccion", seleccion: ["a", "b"] })).toBe(true)
    expect(canalesSinGuardar(null, { modo: "todos", seleccion: [] })).toBe(false)
    expect(canalesSinGuardar(null, { modo: "seleccion", seleccion: [] })).toBe(true)
    expect(canalesSinGuardar([], { modo: "todos", seleccion: [] })).toBe(true)
  })
})
