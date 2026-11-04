import { describe, expect, it } from "vitest"
import { enlaceWhatsapp, queryAvisos, queryInteresados, textoPersonas } from "./logica"

describe("avisos de stock: lógica", () => {
  it("queryAvisos omite el filtro por defecto y acota start", () => {
    expect(queryAvisos({ start: 0, limit: 50 })).toBe("start=0&limit=50")
    expect(queryAvisos({ filtro: "todos", start: -3, limit: 50 })).toBe("start=0&limit=50")
    expect(queryAvisos({ filtro: "quieren_encargar", start: 50, limit: 50 })).toBe("filtro=quieren_encargar&start=50&limit=50")
  })

  it("queryInteresados codifica ids con ':'", () => {
    expect(queryInteresados("mdp:12")).toBe("producto=mdp%3A12")
  })

  it("textoPersonas respeta el singular", () => {
    expect(textoPersonas(1)).toBe("1 persona")
    expect(textoPersonas(2)).toBe("2 personas")
  })

  it("enlaceWhatsapp deja sólo dígitos", () => {
    expect(enlaceWhatsapp("+54 9 11 5555-0000")).toBe("https://wa.me/5491155550000")
    expect(enlaceWhatsapp("sin número")).toBeNull()
  })
})
