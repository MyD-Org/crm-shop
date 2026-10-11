import { describe, expect, it } from "vitest"
import { esKeyDeMaterial, materialKey, TIPOS_MATERIAL, tipoMaterial } from "./material-keys"

const P = "3f2b1c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d"
const U = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"

describe("keys de material", () => {
  it("arma la key con la extensión del tipo", () => {
    expect(materialKey("tenant-mkt", P, U, "video/mp4")).toBe(`marketing/tenant-mkt/material/${P}/${U}.mp4`)
    expect(materialKey("tenant-mkt", P, U, "video/quicktime")).toBe(`marketing/tenant-mkt/material/${P}/${U}.mov`)
  })

  it("rechaza tipos no permitidos y partes inválidas", () => {
    expect(() => materialKey("tenant-mkt", P, U, "application/pdf")).toThrow()
    for (const raro of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(() => materialKey("tenant-mkt", P, U, raro)).toThrow()
      expect(tipoMaterial(raro)).toBeNull()
    }
    expect(() => materialKey("Tenant Raro", P, U, "video/mp4")).toThrow()
  })

  it("sólo acepta keys del tenant y de la pieza", () => {
    expect(esKeyDeMaterial("tenant-mkt", P, `marketing/tenant-mkt/material/${P}/${U}.mp4`)).toBe(true)
    expect(esKeyDeMaterial("tenant-mkt", P, `marketing/otro/material/${P}/${U}.mp4`)).toBe(false)
    expect(esKeyDeMaterial("tenant-mkt", P, `marketing/tenant-mkt/material/${P}/../x.mp4`)).toBe(false)
  })

  it("los videos admiten hasta 300 MB y las fotos hasta 20 MB", () => {
    expect(TIPOS_MATERIAL["video/mp4"].maxBytes).toBe(300 * 1024 * 1024)
    expect(TIPOS_MATERIAL["image/jpeg"].maxBytes).toBe(20 * 1024 * 1024)
  })
})
