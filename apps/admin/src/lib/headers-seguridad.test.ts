import { describe, expect, it } from "vitest"
import { headersDeSeguridad } from "./headers-seguridad"

describe("headersDeSeguridad", () => {
  it("manda nosniff, referrer, frame SAMEORIGIN (el portal enmarca sus PDF), permisos y HSTS", () => {
    const h = Object.fromEntries(headersDeSeguridad().map(({ key, value }) => [key, value]))
    expect(h["X-Content-Type-Options"]).toBe("nosniff")
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN")
    expect(h["Permissions-Policy"]).toContain("camera=()")
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=\d+$/)
    expect(h["Content-Security-Policy"]).toBeUndefined()
  })
})
