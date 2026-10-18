import { describe, it, expect } from "vitest"
import { adminLinkBase } from "./admin-links"

describe("adminLinkBase", () => {
  it("usa el host del request (el subdominio del tenant)", () => {
    const req = new Request("http://interno/api/x", {
      headers: { host: "avantec.plataforma.example", "x-forwarded-proto": "https" },
    })
    expect(adminLinkBase(req)).toBe("https://avantec.plataforma.example")
  })

  it("sin headers de proxy cae a la URL del request", () => {
    expect(adminLinkBase(new Request("http://avantec.localhost:3000/api/x"))).toBe("http://avantec.localhost:3000")
  })
})
