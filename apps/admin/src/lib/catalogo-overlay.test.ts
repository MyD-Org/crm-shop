import { describe, it, expect } from "vitest"
import {
  slugify,
  esSlugValido,
  esNivelValido,
  validarCategoria,
  validarMovimiento,
  validarTag,
  nombreEfectivo,
  skuEfectivo,
  tienePrecio,
  motivoNoPublicado,
  estaPublicado,
  type NodoCategoria,
} from "./catalogo-overlay"

// Lógica pura del catálogo comercial. La tabla de casos de motivoNoPublicado() es copia de la
// del contrato (platform/contracts/catalogo-overlay/v1): es lo que prueba la paridad con el
// Shop sin levantar los dos repos.

describe("slugify", () => {
  it("saca acentos, baja a minúsculas y colapsa separadores", () => {
    expect(slugify("Iluminación LED")).toBe("iluminacion-led")
    expect(slugify("  Cables / Redes  ")).toBe("cables-redes")
    expect(slugify("Térmica 2x16")).toBe("termica-2x16")
  })

  it("devuelve vacío cuando no queda nada utilizable", () => {
    expect(slugify("///")).toBe("")
    expect(slugify("   ")).toBe("")
  })

  it("produce siempre un slug con el formato del CHECK de la migración", () => {
    for (const texto of ["Iluminación LED", "Cables / Redes", "A--B"]) {
      expect(esSlugValido(slugify(texto))).toBe(true)
    }
  })
})

describe("esNivelValido", () => {
  it("acepta 1..3 y rechaza el resto", () => {
    expect(esNivelValido(1)).toBe(true)
    expect(esNivelValido(3)).toBe(true)
    expect(esNivelValido(4)).toBe(false)
    expect(esNivelValido(0)).toBe(false)
    expect(esNivelValido(1.5)).toBe(false)
  })
})

describe("validarCategoria", () => {
  it("deriva el slug del nombre", () => {
    const r = validarCategoria({ nombre: "Iluminación LED" })
    expect(r.ok && r.value.slug).toBe("iluminacion-led")
    expect(r.ok && r.value.parentId).toBe(null)
  })

  it("rechaza el nombre vacío con un mensaje en español formal de usted", () => {
    const r = validarCategoria({ nombre: "   " })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/^Indique /)
  })

  it("rechaza un nombre del que no sale ningún slug", () => {
    const r = validarCategoria({ nombre: "///" })
    expect(r.ok).toBe(false)
  })

  it("es parcial: lo que no viene en el body conserva el valor actual", () => {
    const actual = { nombre: "Cables", slug: "cables", parentId: "p1", orden: 5, activa: true }
    const r = validarCategoria({ activa: false }, actual)
    expect(r.ok && r.value.nombre).toBe("Cables")
    expect(r.ok && r.value.parentId).toBe("p1")
    expect(r.ok && r.value.orden).toBe(5)
    expect(r.ok && r.value.activa).toBe(false)
  })
})

describe("validarMovimiento", () => {
  // A > B > C, más una raíz Z suelta.
  const arbol: NodoCategoria[] = [
    { id: "A", parentId: null },
    { id: "B", parentId: "A" },
    { id: "C", parentId: "B" },
    { id: "Z", parentId: null },
  ]

  it("acepta un alta de segundo nivel", () => {
    const r = validarMovimiento(arbol, null, "A")
    expect(r.ok && r.value.nivel).toBe(2)
  })

  it("rechaza un cuarto nivel", () => {
    const r = validarMovimiento(arbol, null, "C")
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain("3 niveles")
  })

  it("rechaza un ciclo: A no puede colgar de su propia hija", () => {
    const r = validarMovimiento(arbol, "A", "B")
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain("sí misma")
  })

  it("rechaza que una categoría dependa de sí misma", () => {
    const r = validarMovimiento(arbol, "A", "A")
    expect(r.ok).toBe(false)
  })

  it("rechaza mover una rama que haría 4 niveles, aunque la categoría sola cabría", () => {
    // Z > A > B > C = 4 niveles. A sola cabría bajo Z; su rama no.
    const r = validarMovimiento(arbol, "A", "Z")
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain("3 niveles")
  })

  it("acepta mover una hoja bajo otra raíz", () => {
    const r = validarMovimiento(arbol, "C", "Z")
    expect(r.ok && r.value.nivel).toBe(2)
  })

  it("rechaza un padre inexistente", () => {
    const r = validarMovimiento(arbol, null, "no-existe")
    expect(r.ok).toBe(false)
  })

  it("acepta mover una categoría a la raíz", () => {
    const r = validarMovimiento(arbol, "B", null)
    expect(r.ok && r.value.nivel).toBe(1)
  })
})

describe("validarTag", () => {
  it("deriva el slug del nombre", () => {
    const r = validarTag({ nombre: "Liquidación de invierno" })
    expect(r.ok && r.value).toEqual({ nombre: "Liquidación de invierno", slug: "liquidacion-de-invierno" })
  })

  it("recorta espacios sobrantes del nombre", () => {
    const r = validarTag({ nombre: "  Oferta  " })
    expect(r.ok && r.value.nombre).toBe("Oferta")
  })

  it("produce el mismo slug para variantes de may/min y espacios (la unicidad es por slug)", () => {
    const a = validarTag({ nombre: "Oferta" })
    const b = validarTag({ nombre: "  OFERTA " })
    expect(a.ok && b.ok && a.value.slug === b.value.slug).toBe(true)
  })

  it("rechaza la jerarquía: los tags son planos", () => {
    expect(validarTag({ nombre: "Oferta", parentId: "x" }).ok).toBe(false)
    expect(validarTag({ nombre: "Oferta", nivel: 2 }).ok).toBe(false)
  })

  it("rechaza el nombre vacío", () => {
    expect(validarTag({ nombre: "" }).ok).toBe(false)
    expect(validarTag({}).ok).toBe(false)
  })
})

describe("nombreEfectivo / skuEfectivo", () => {
  const producto = { name: "JDSDA261", description: "TERMICA 2X16", code: null }

  it("usa el nombre propio cuando lo hay", () => {
    expect(nombreEfectivo("Térmica bipolar 16A", producto)).toBe("Térmica bipolar 16A")
  })

  it("cae a la descripción de Alegra sin nombre propio", () => {
    expect(nombreEfectivo(null, producto)).toBe("TERMICA 2X16")
  })

  it("cae al name de Alegra sin descripción", () => {
    expect(nombreEfectivo(null, { ...producto, description: "" })).toBe("JDSDA261")
    expect(nombreEfectivo(null, { ...producto, description: null })).toBe("JDSDA261")
  })

  it("vaciar el nombre propio vuelve al default (no es un error)", () => {
    expect(nombreEfectivo("   ", producto)).toBe("TERMICA 2X16")
  })

  it("nunca devuelve cadena vacía ni 'null'", () => {
    expect(nombreEfectivo("", { name: "JDSDA261", description: null })).toBe("JDSDA261")
  })

  it("el SKU es el code, y sin code el name", () => {
    expect(skuEfectivo({ name: "JDSDA261", code: "TB16" })).toBe("TB16")
    expect(skuEfectivo(producto)).toBe("JDSDA261")
    expect(skuEfectivo({ name: "JDSDA261", code: "  " })).toBe("JDSDA261")
  })
})

describe("tienePrecio", () => {
  it("pide al menos un precio de lista mayor a cero", () => {
    expect(tienePrecio([{ idPriceList: "1", price: 1500 }])).toBe(true)
    expect(tienePrecio([{ idPriceList: "1", price: "1500.50" }])).toBe(true)
    expect(tienePrecio([{ idPriceList: "1", price: 0 }])).toBe(false)
    expect(tienePrecio([])).toBe(false)
    expect(tienePrecio(null)).toBe(false)
    expect(tienePrecio("no es un array")).toBe(false)
  })
})

describe("motivoNoPublicado — tabla de casos del contrato", () => {
  const precio = [{ idPriceList: "1", price: 1500 }]

  it("publicado: visible, activo y con precio (tenga o no fotos)", () => {
    expect(motivoNoPublicado({ visible: true, status: "active", prices: precio })).toEqual([])
    expect(estaPublicado({ visible: true, status: "active", prices: precio })).toBe(true)
  })

  it("oculto a propósito", () => {
    expect(motivoNoPublicado({ visible: false, status: "active", prices: precio })).toEqual(["oculto"])
  })

  it("visible pero sin precio", () => {
    expect(motivoNoPublicado({ visible: true, status: "active", prices: [] })).toEqual(["sin_precio"])
  })

  it("inactivo en Alegra", () => {
    expect(motivoNoPublicado({ visible: true, status: "inactive", prices: precio })).toEqual(["inactivo_en_alegra"])
  })

  it("devuelve TODOS los motivos que aplican, no el primero", () => {
    expect(motivoNoPublicado({ visible: false, status: "inactive", prices: [] })).toEqual([
      "oculto",
      "inactivo_en_alegra",
      "sin_precio",
    ])
  })

  it("sin fila de overlay (visible=false por default) el motivo es que está oculto", () => {
    expect(motivoNoPublicado({ visible: false, status: "active", prices: precio })).toEqual(["oculto"])
  })
})
