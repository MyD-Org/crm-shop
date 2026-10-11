import { describe, expect, it } from "vitest"
import { ESTADOS_EDITABLES, puedeTransicionar } from "./estados"

describe("transiciones de piezas", () => {
  it("el usuario aprueba, pide cambios o descarta una pieza en revisión", () => {
    expect(puedeTransicionar("usuario", "para_revisar", "aprobada")).toBe(true)
    expect(puedeTransicionar("usuario", "para_revisar", "cambios_pedidos")).toBe(true)
    expect(puedeTransicionar("usuario", "para_revisar", "descartada")).toBe(true)
  })

  it("el usuario marca como publicada a mano una pieza aprobada (sin ai-api)", () => {
    expect(puedeTransicionar("usuario", "aprobada", "publicada")).toBe(true)
  })

  it("el studio sólo termina un render: a revisión o con error de contenido", () => {
    expect(puedeTransicionar("studio", "renderizando", "para_revisar")).toBe(true)
    expect(puedeTransicionar("studio", "renderizando", "cambios_pedidos")).toBe(true)
    expect(puedeTransicionar("studio", "para_revisar", "aprobada")).toBe(false)
  })

  it("el planificador devuelve a borrador una pieza con cambios pedidos", () => {
    expect(puedeTransicionar("planificador", "cambios_pedidos", "borrador")).toBe(true)
    expect(puedeTransicionar("planificador", "para_revisar", "aprobada")).toBe(false)
  })

  it("ai-api publica sólo lo aprobado y puede reintentar lo fallido", () => {
    expect(puedeTransicionar("aiapi", "aprobada", "programada")).toBe(true)
    expect(puedeTransicionar("aiapi", "programada", "publicada")).toBe(true)
    expect(puedeTransicionar("aiapi", "programada", "fallida")).toBe(true)
    expect(puedeTransicionar("aiapi", "fallida", "programada")).toBe(true)
    expect(puedeTransicionar("aiapi", "para_revisar", "publicada")).toBe(false)
  })

  it("el sistema libera un claim vencido", () => {
    expect(puedeTransicionar("sistema", "renderizando", "borrador")).toBe(true)
  })

  it("nadie saca una pieza de publicada o descartada", () => {
    for (const actor of ["usuario", "planificador", "studio", "aiapi", "sistema"] as const) {
      expect(puedeTransicionar(actor, "publicada", "borrador")).toBe(false)
      expect(puedeTransicionar(actor, "descartada", "borrador")).toBe(false)
    }
  })

  it("no se edita una pieza mientras se renderiza ni una vez publicada", () => {
    expect(ESTADOS_EDITABLES).not.toContain("renderizando")
    expect(ESTADOS_EDITABLES).not.toContain("publicada")
    expect(ESTADOS_EDITABLES).toContain("aprobada")
  })
})
