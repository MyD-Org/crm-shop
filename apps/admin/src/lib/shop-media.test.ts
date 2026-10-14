import { describe, expect, it } from "vitest"
import {
  basePublicaFotos,
  esAnchoValido,
  fichaContenidoKey,
  fichaKey,
  fotoKey,
  idDeRuta,
  marcaKey,
  prefijoProducto,
  segmentoProducto,
  shaDeFichaContenidoKey,
  shopMediaConfig,
  urlPublicaFoto,
} from "./shop-media"

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

describe("fichaKey", () => {
  it("arma la key con el tenant, el producto y el id", () => {
    expect(fichaKey("central-led", "9001", UUID)).toBe(`productos/central-led/9001/ficha-${UUID}.pdf`)
  })

  it("rechaza partes que romperían el layout de keys", () => {
    expect(() => fichaKey("../otro", "9001", UUID)).toThrow()
    expect(() => fichaKey("t", "../9001", UUID)).toThrow()
    expect(() => fichaKey("t", "9001", "no-es-uuid")).toThrow()
  })
})

describe("fichaContenidoKey", () => {
  const SHA = "ab".repeat(32)

  it("arma la key por contenido: tenant + sha256, sin producto", () => {
    expect(fichaContenidoKey("central-led", SHA)).toBe(`productos/central-led/fichas/${SHA}.pdf`)
  })

  it("rechaza tenants y hashes que romperían el layout", () => {
    expect(() => fichaContenidoKey("../otro", SHA)).toThrow()
    expect(() => fichaContenidoKey("t", "abc")).toThrow()
    expect(() => fichaContenidoKey("t", SHA.toUpperCase())).toThrow()
    expect(() => fichaContenidoKey("t", `${SHA}/../x`)).toThrow()
  })

  it("shaDeFichaContenidoKey reconoce sólo las keys de ese tenant", () => {
    expect(shaDeFichaContenidoKey("t", fichaContenidoKey("t", SHA))).toBe(SHA)
    expect(shaDeFichaContenidoKey("otro", fichaContenidoKey("t", SHA))).toBeNull()
    expect(shaDeFichaContenidoKey("t", `productos/t/9001/ficha-${UUID}.pdf`)).toBeNull()
    expect(shaDeFichaContenidoKey("t", `productos/t/fichas/${SHA}.png`)).toBeNull()
    expect(shaDeFichaContenidoKey("t", `productos/t/fichas/${"z".repeat(64)}.pdf`)).toBeNull()
  })
})

describe("segmentoProducto", () => {
  it("deja igual los ids numéricos y reemplaza el ':' de los de cuenta secundaria", () => {
    expect(segmentoProducto("12")).toBe("12")
    expect(segmentoProducto("mdp:12")).toBe("mdp_12")
  })

  it("rechaza ids malformados", () => {
    for (const malo of ["../x", "mdp:", "MDP:1", "mdp:12:3", "", "a/b", ":12", "mdp:x"]) {
      expect(() => segmentoProducto(malo), malo).toThrow("El identificador del producto no es válido.")
    }
  })
})

describe("keys de productos de cuenta secundaria", () => {
  it("fotoKey y fichaKey con id numérico siguen idénticas a las ya guardadas", () => {
    expect(fotoKey("central-led", "9001", UUID, 320)).toBe(`productos/central-led/9001/${UUID}-320.webp`)
    expect(fichaKey("central-led", "9001", UUID)).toBe(`productos/central-led/9001/ficha-${UUID}.pdf`)
  })

  it("con mdp:12 la key no lleva ':' y cuelga del prefijo del producto", () => {
    const foto = fotoKey("t", "mdp:12", UUID, 800)
    const ficha = fichaKey("t", "mdp:12", UUID)
    expect(foto).toBe(`productos/t/mdp_12/${UUID}-800.webp`)
    expect(ficha).toBe(`productos/t/mdp_12/ficha-${UUID}.pdf`)
    expect(foto.includes(":")).toBe(false)
    expect(foto.startsWith(prefijoProducto("t", "mdp:12"))).toBe(true)
    expect(ficha.startsWith(prefijoProducto("t", "mdp:12"))).toBe(true)
  })

  it("el prefijo de un producto no acepta keys de otro producto ni de otro tenant", () => {
    const prefijo = prefijoProducto("t", "mdp:12")
    expect(fotoKey("t", "mdp:120", UUID, 800).startsWith(prefijo)).toBe(false)
    expect(fotoKey("t", "12", UUID, 800).startsWith(prefijo)).toBe(false)
    expect(fotoKey("otro", "mdp:12", UUID, 800).startsWith(prefijo)).toBe(false)
  })

  it("rechaza ids inválidos", () => {
    expect(() => fotoKey("t", "../x", UUID, 800)).toThrow()
    expect(() => fichaKey("t", "mdp:", UUID)).toThrow()
    expect(() => prefijoProducto("../t", "12")).toThrow()
  })
})

describe("idDeRuta", () => {
  it("decodifica el ':' codificado y deja pasar lo demás", () => {
    expect(idDeRuta("mdp%3A12")).toBe("mdp:12")
    expect(idDeRuta("mdp:12")).toBe("mdp:12")
    expect(idDeRuta("12")).toBe("12")
    expect(idDeRuta("%E0%A4%A")).toBe("%E0%A4%A")
  })
})

describe("marcaKey", () => {
  it("arma marca/{tenant}/{uuid}.{ext}", () => {
    expect(marcaKey("tienda-uno", UUID, "svg")).toBe(`marca/tienda-uno/${UUID}.svg`)
    expect(marcaKey("tienda-uno", UUID, "png")).toBe(`marca/tienda-uno/${UUID}.png`)
    expect(marcaKey("t", UUID, "webp")).toBe(`marca/t/${UUID}.webp`)
    expect(marcaKey("t", UUID, "jpg")).toBe(`marca/t/${UUID}.jpg`)
  })

  it("rechaza tenant, uuid o extensión inválidos", () => {
    expect(() => marcaKey("../t", UUID, "png")).toThrow()
    expect(() => marcaKey("T", UUID, "png")).toThrow()
    expect(() => marcaKey("t", "no-es-uuid", "png")).toThrow()
    expect(() => marcaKey("t", UUID, "gif" as never)).toThrow()
    expect(() => marcaKey("t", UUID, "png/../x" as never)).toThrow()
  })

  it("no puede pisar las keys de productos ni de categorías", () => {
    const k = marcaKey("t", UUID, "png")
    expect(k.startsWith("productos/")).toBe(false)
    expect(k.startsWith("categorias/")).toBe(false)
  })
})
