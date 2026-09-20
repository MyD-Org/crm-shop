import { describe, expect, it } from "vitest"
import { basePublicaFotos, esAnchoValido, fotoKey, shopMediaConfig, urlPublicaFoto } from "./shop-media"

const ID = "0123456789ab4cde8f0123456789abcd"
const UUID = `${ID.slice(0, 8)}-${ID.slice(8, 12)}-${ID.slice(12, 16)}-${ID.slice(16, 20)}-${ID.slice(20)}`

const ENV_OK = {
  R2_ACCOUNT_ID: "cuenta",
  R2_SHOP_MEDIA_ACCESS_KEY_ID: "llave",
  R2_SHOP_MEDIA_SECRET_ACCESS_KEY: "secreto",
  R2_SHOP_MEDIA_BUCKET: "shop-media",
  R2_SHOP_MEDIA_PUBLIC_URL: "https://fotos.test",
}

describe("shopMediaConfig", () => {
  it("arma la config con las credenciales propias del bucket público", () => {
    expect(shopMediaConfig(ENV_OK)).toMatchObject({ bucket: "shop-media", publicUrl: "https://fotos.test" })
  })

  it("es null si falta cualquiera de las credenciales", () => {
    for (const faltante of Object.keys(ENV_OK)) {
      const env = { ...ENV_OK, [faltante]: undefined }
      expect(shopMediaConfig(env), `sin ${faltante}`).toBeNull()
    }
  })

  it("no hereda las credenciales del bucket de comprobantes", () => {
    // Si las heredara, un entorno con sólo las viejas subiría fotos al bucket de comprobantes.
    const env = { R2_ACCOUNT_ID: "c", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "crm-portal" }
    expect(shopMediaConfig(env)).toBeNull()
  })

  it("le saca la barra final a la base pública", () => {
    expect(shopMediaConfig({ ...ENV_OK, R2_SHOP_MEDIA_PUBLIC_URL: "https://fotos.test/" })?.publicUrl).toBe(
      "https://fotos.test",
    )
  })
})

describe("basePublicaFotos", () => {
  it("no necesita credenciales: componer una url sólo pide el dominio", () => {
    expect(basePublicaFotos({ R2_SHOP_MEDIA_PUBLIC_URL: "https://fotos.test/" })).toBe("https://fotos.test")
  })

  it("es null sin dominio, y entonces la url también", () => {
    expect(basePublicaFotos({})).toBeNull()
    expect(urlPublicaFoto("productos/t/1/x-800.webp", null)).toBeNull()
  })
})

describe("fotoKey", () => {
  it("arma la key con el tenant, el producto, el id y el ancho", () => {
    expect(fotoKey("central-led", "9001", UUID, 800)).toBe(`productos/central-led/9001/${UUID}-800.webp`)
  })

  it("las variantes de una misma foto comparten prefijo", () => {
    const prefijo = (w: number) => fotoKey("t", "9001", UUID, w).replace(/-\d+\.webp$/, "")
    expect(prefijo(320)).toBe(prefijo(1600))
  })

  it("rechaza partes que romperían el layout de keys", () => {
    expect(() => fotoKey("../otro", "9001", UUID, 800)).toThrow()
    expect(() => fotoKey("t", "../9001", UUID, 800)).toThrow()
    expect(() => fotoKey("t", "9001", "no-es-uuid", 800)).toThrow()
    expect(() => fotoKey("t", "9001", UUID, 999)).toThrow()
  })
})

describe("esAnchoValido", () => {
  it("sólo acepta los anchos que el panel genera", () => {
    expect([320, 800, 1600].every(esAnchoValido)).toBe(true)
    expect(esAnchoValido(640)).toBe(false)
  })
})
