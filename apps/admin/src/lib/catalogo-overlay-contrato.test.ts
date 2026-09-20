import { describe, it, expect } from "vitest"
import {
  LIMIT_DEFAULT,
  armarContratoOverlayV1,
  armarContratoTaxonomiaV1,
  parsearParamsDelta,
  type CategoriaFila,
  type OverlayFila,
  type TagFila,
} from "@/lib/catalogo-overlay-contrato"
import { validarJsonSchema } from "../../test/contracts/json-schema-lite"
import schemaTaxonomia from "../../test/contracts/catalogo-overlay/v1/schema-taxonomia.json"
import schemaOverlay from "../../test/contracts/catalogo-overlay/v1/schema-overlay.json"
import taxonomiaValida from "../../test/contracts/catalogo-overlay/v1/fixtures/taxonomia-valida.json"
import taxonomiaInvalida from "../../test/contracts/catalogo-overlay/v1/fixtures/taxonomia-invalida.json"
import overlayValido from "../../test/contracts/catalogo-overlay/v1/fixtures/overlay-valido.json"
import overlayInvalido from "../../test/contracts/catalogo-overlay/v1/fixtures/overlay-invalido.json"

// El payload que arma el CRM tiene que validar contra el contrato publicado (copia de
// MyD-Org/platform/contracts/catalogo-overlay/v1 en test/contracts/; actualizar ambas juntas).
// El Shop valida los MISMOS fixtures del otro lado: es lo que prueba la paridad sin levantar
// los dos repos.

const T = new Date("2026-09-18T12:00:00.000Z")
const T2 = new Date("2026-09-18T13:00:00.000Z")
// Los timestamps del delta viajan como texto ISO con MICROSEGUNDOS: el round-trip por `Date`
// truncaría al milisegundo y dejaría el cursor por debajo de la fila que lo generó.
const ISO = "2026-09-18T12:00:00.123456Z"
const ISO2 = "2026-09-18T13:00:00.654321Z"

const cat = (extra: Partial<CategoriaFila>): CategoriaFila => ({
  id: "8f3a0c7e-0000-4000-8000-000000000001",
  parentId: null,
  nombre: "Iluminación",
  slug: "iluminacion",
  orden: 0,
  nivel: 1,
  activa: true,
  imagenKey: null,
  updatedAt: T,
  ...extra,
})

const tag = (extra: Partial<TagFila>): TagFila => ({
  id: "1b7c0c7e-0000-4000-8000-000000000001",
  nombre: "Oferta",
  slug: "oferta",
  updatedAt: T,
  ...extra,
})

const fila = (extra: Partial<OverlayFila>): OverlayFila => ({
  alegraId: "12345",
  visible: true,
  nombre: null,
  descripcion: null,
  categoriaId: null,
  orden: null,
  tagIds: [],
  fotos: [],
  updatedAt: ISO,
  ...extra,
})

describe("contrato catalogo-overlay v1: fixtures", () => {
  it("taxonomía válida pasa", () => {
    expect(validarJsonSchema(schemaTaxonomia, taxonomiaValida)).toEqual([])
  })

  it("taxonomía inválida se rechaza por cada motivo documentado", () => {
    const errores = validarJsonSchema(schemaTaxonomia, taxonomiaInvalida).join("\n")
    expect(errores).toMatch(/categorias\[0\]\.nivel: > maximum/)
    expect(errores).toMatch(/categorias\[0\]\.slug: no cumple pattern/)
    expect(errores).toMatch(/categorias\[0\]\.descripcion: propiedad no permitida/)
    expect(errores).toMatch(/tags\[0\]\.color: propiedad no permitida/)
  })

  it("overlay válido pasa", () => {
    expect(validarJsonSchema(schemaOverlay, overlayValido)).toEqual([])
  })

  it("overlay inválido se rechaza por cada motivo documentado", () => {
    const errores = validarJsonSchema(schemaOverlay, overlayInvalido).join("\n")
    expect(errores).toMatch(/items\[0\]\.precio: propiedad no permitida/)
    expect(errores).toMatch(/items\[0\]\.visible: tipo string/)
    expect(errores).toMatch(/items\[0\]\.tagIds\[0\]: no cumple pattern/)
    expect(errores).toMatch(/\$\.nextCursor: requerido/)
  })
})

describe("armarContratoTaxonomiaV1", () => {
  it("vacío es un payload VÁLIDO, no un fallo, y usa `ahora`", () => {
    const c = armarContratoTaxonomiaV1({ baseFotos: "https://fotos.test", tenant: "t", categorias: [], tags: [], ahora: T })
    expect(validarJsonSchema(schemaTaxonomia, c)).toEqual([])
    expect(c).toMatchObject({ version: "v1", categorias: [], tags: [], actualizadoEn: T.toISOString() })
  })

  it("ordena por nivel, parentId (raíces primero), orden y nombre; los tags por nombre", () => {
    const padre = "8f3a0c7e-0000-4000-8000-000000000002"
    const c = armarContratoTaxonomiaV1({ baseFotos: "https://fotos.test",
      tenant: "t",
      ahora: T,
      categorias: [
        cat({ id: padre, nombre: "Cables", slug: "cables", parentId: padre, nivel: 2, orden: 1 }),
        cat({ id: "8f3a0c7e-0000-4000-8000-000000000003", nombre: "Alambres", slug: "alambres", parentId: padre, nivel: 2, orden: 0 }),
        cat({ nombre: "Zócalos", slug: "zocalos", orden: 1 }),
        cat({ id: "8f3a0c7e-0000-4000-8000-000000000004", nombre: "Aberturas", slug: "aberturas", orden: 1 }),
      ],
      tags: [tag({ nombre: "Oferta" }), tag({ id: "1b7c0c7e-0000-4000-8000-000000000002", nombre: "Nuevo", slug: "nuevo" })],
    })
    expect(validarJsonSchema(schemaTaxonomia, c)).toEqual([])
    expect(c.categorias.map((x) => x.nombre)).toEqual(["Aberturas", "Zócalos", "Alambres", "Cables"])
    expect(c.tags.map((x) => x.nombre)).toEqual(["Nuevo", "Oferta"])
  })

  it("las inactivas viajan igual, y actualizadoEn es el máximo entre categorías y tags", () => {
    const c = armarContratoTaxonomiaV1({ baseFotos: "https://fotos.test",
      tenant: "t",
      ahora: new Date("2020-01-01T00:00:00.000Z"),
      categorias: [cat({ activa: false })],
      tags: [tag({ updatedAt: T2 })],
    })
    expect(c.categorias[0].activa).toBe(false)
    expect(c.actualizadoEn).toBe(T2.toISOString())
  })
})

describe("armarContratoOverlayV1", () => {
  it("vacío: sin cursor y sin más páginas", () => {
    const c = armarContratoOverlayV1({ baseFotos: "https://fotos.test", tenant: "t", filas: [], limit: LIMIT_DEFAULT })
    expect(validarJsonSchema(schemaOverlay, c)).toEqual([])
    expect(c).toMatchObject({ items: [], nextCursor: null, hasMore: false })
  })

  it("nextCursor es el ÚLTIMO ítem de ESTA página cuando la página vino llena", () => {
    const c = armarContratoOverlayV1({ baseFotos: "https://fotos.test",
      tenant: "t",
      limit: 2,
      filas: [fila({ alegraId: "12345" }), fila({ alegraId: "12346", updatedAt: ISO2 })],
    })
    expect(validarJsonSchema(schemaOverlay, c)).toEqual([])
    expect(c.hasMore).toBe(true)
    // Microsegundos intactos: es lo que hace que el cursor avance de verdad.
    expect(c.nextCursor).toEqual({ desde: ISO2, cursor: "12346" })
  })

  it("página incompleta ⇒ hasMore false y nextCursor null", () => {
    const c = armarContratoOverlayV1({ baseFotos: "https://fotos.test", tenant: "t", limit: 500, filas: [fila({})] })
    expect(c.hasMore).toBe(false)
    expect(c.nextCursor).toBeNull()
  })

  it("nombre y descripción vacíos viajan como null (vaciar el campo vuelve al default de Alegra)", () => {
    const c = armarContratoOverlayV1({ baseFotos: "https://fotos.test",
      tenant: "t",
      limit: 500,
      filas: [fila({ nombre: "   ", descripcion: "" })],
    })
    expect(validarJsonSchema(schemaOverlay, c)).toEqual([])
    expect(c.items[0]).toMatchObject({ nombre: null, descripcion: null })
  })

  it("despublicar viaja como visible:false, no como borrado, y valida contra el schema", () => {
    const c = armarContratoOverlayV1({ baseFotos: "https://fotos.test",
      tenant: "t",
      limit: 500,
      filas: [
        fila({
          alegraId: "9001",
          visible: false,
          nombre: "Térmica bipolar 16A",
          categoriaId: "8f3a0c7e-0000-4000-8000-000000000001",
          orden: 3,
          tagIds: ["1b7c0c7e-0000-4000-8000-000000000001"],
          fotos: [{ key: "productos/t/9001/0123456789abcdef01234567-800.webp", w: 800, alt: "Térmica" }],
        }),
      ],
    })
    expect(validarJsonSchema(schemaOverlay, c)).toEqual([])
    expect(c.items[0].visible).toBe(false)
  })
})

describe("parsearParamsDelta", () => {
  const p = (q: string) => parsearParamsDelta(new URLSearchParams(q))

  it("sin parámetros: carga inicial con el limit por defecto", () => {
    expect(p("")).toEqual({ ok: true, value: { desde: null, cursor: "", limit: LIMIT_DEFAULT } })
  })

  it("desde viaja TAL CUAL, con sus microsegundos, sin pasar por Date", () => {
    expect(p(`desde=${ISO}`)).toEqual({ ok: true, value: { desde: ISO, cursor: "", limit: LIMIT_DEFAULT } })
  })

  it("limit fuera de rango o no entero se rechaza", () => {
    for (const q of ["limit=0", "limit=1001", "limit=-1", "limit=1.5", "limit=abc"]) {
      expect(p(q)).toEqual({ ok: false, error: "invalid limit" })
    }
    expect(p("limit=1")).toMatchObject({ ok: true })
    expect(p("limit=1000")).toMatchObject({ ok: true })
  })

  it("desde que no parsea se rechaza", () => {
    for (const q of ["desde=ayer", "desde=2026", "desde=2026-09-18", "desde=' or 1=1"]) {
      expect(p(q)).toEqual({ ok: false, error: "invalid desde" })
    }
  })

  it("el cursor SÓLO se interpreta si vino desde", () => {
    expect(p("cursor=12345")).toMatchObject({ ok: true, value: { desde: null, cursor: "" } })
    expect(p(`desde=${ISO}&cursor=12345`)).toEqual({
      ok: true,
      value: { desde: ISO, cursor: "12345", limit: LIMIT_DEFAULT },
    })
  })
})
