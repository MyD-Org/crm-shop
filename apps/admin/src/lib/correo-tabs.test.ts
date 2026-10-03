import { describe, expect, it } from "vitest"
import { CANAL_TODAS, type CanalTab } from "./inbox-canales"
import { buildCasillaTabs, casillaIdDeTab, casillaTabKey, esTabCasilla, resolveSelectedConCasillas } from "./correo-tabs"

const casillas = [
  { id: "c1", nombre: "Ventas", email: "ventas@cliente.example" },
  { id: "c2", nombre: "", email: "soporte@cliente.example" },
]
const canales: CanalTab[] = [{ key: "wa1", label: "Wsp Mdp", pending: 0 }]

describe("tabs de casillas de correo dentro de Mensajes", () => {
  it("una tab por casilla, con el nombre visible o, sin nombre, el email, y su conteo de no leídos", () => {
    const tabs = buildCasillaTabs(casillas, { c1: 3 })
    expect(tabs).toEqual([
      { key: "correo:c1", casillaId: "c1", label: "Ventas", noLeidos: 3 },
      { key: "correo:c2", casillaId: "c2", label: "soporte@cliente.example", noLeidos: 0 },
    ])
  })

  it("sin casillas no hay tabs", () => {
    expect(buildCasillaTabs([], {})).toEqual([])
  })

  it("las claves de casilla no se confunden con las de canal", () => {
    expect(esTabCasilla(casillaTabKey("c1"))).toBe(true)
    expect(esTabCasilla("wa1")).toBe(false)
    expect(esTabCasilla(CANAL_TODAS)).toBe(false)
    expect(casillaIdDeTab("correo:c1")).toBe("c1")
    expect(casillaIdDeTab("wa1")).toBeNull()
  })

  it("resolveSelected: la casilla elegida vale si sigue accesible; si no, cae a Todos", () => {
    const tabs = buildCasillaTabs(casillas, {})
    expect(resolveSelectedConCasillas("correo:c2", canales, tabs)).toBe("correo:c2")
    expect(resolveSelectedConCasillas("correo:borrada", canales, tabs)).toBe(CANAL_TODAS)
    expect(resolveSelectedConCasillas("wa1", canales, tabs)).toBe("wa1")
    expect(resolveSelectedConCasillas("canal-que-no-existe", canales, tabs)).toBe(CANAL_TODAS)
  })

  it("con una casilla elegida pero sin acceso ya (flag apagado => sin tabs) no queda en una casilla fantasma", () => {
    expect(resolveSelectedConCasillas("correo:c1", canales, [])).toBe(CANAL_TODAS)
  })
})
