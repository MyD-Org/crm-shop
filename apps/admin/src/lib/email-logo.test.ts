import { describe, expect, it } from "vitest"
import { logoMailDeTenant } from "@/lib/email-logo"

const SHOP = "https://tienda.example"

describe("logoMailDeTenant", () => {
  it("un logo propio apto para mail (absoluto, PNG) manda", () => {
    expect(logoMailDeTenant({ id: "central-led", logoPath: "https://cdn.example/logo.png", shopUrl: SHOP }, {})).toBe(
      "https://cdn.example/logo.png",
    )
  })

  it("Central sin logo propio: el logo de mail que publica su tienda", () => {
    expect(logoMailDeTenant({ id: "central-led", logoPath: "/logos/central-led.svg", shopUrl: SHOP }, {})).toBe(
      `${SHOP}/images/central-led/logo-mail.png`,
    )
  })

  it("Central sin URL de tienda: sin logo (cabecera en texto)", () => {
    expect(logoMailDeTenant({ id: "central-led", logoPath: "/logos/central-led.svg" }, {})).toBeNull()
  })

  it("otra marca nunca recibe el logo de Central", () => {
    expect(logoMailDeTenant({ id: "otra-marca", logoPath: "/logos/otra-marca.svg", shopUrl: SHOP }, {})).toBeNull()
  })
})
