import { describe, it, expect } from "vitest"
import {
  RANGOS_PLAUSIBLES,
  cablesSinSeccion,
  contarFueraDeRango,
  fueraDeRango,
  planearBackfillSeccion,
  seccionDeNombre,
  type FilaAuditada,
} from "./catalogo-atributos-auditoria"
import { DEFINICION_ATRIBUTOS, pareceCable, type ClaveAtributo } from "./catalogo-atributos-extraccion"

const fila = (clave: string, valorNum: number | null, extra: Partial<FilaAuditada> = {}): FilaAuditada => ({
  alegraId: "1",
  clave,
  valorNum,
  valorTexto: null,
  fuente: "nombre",
  nombre: "PRODUCTO DE PRUEBA",
  publicado: true,
  ...extra,
})

describe("rangos plausibles", () => {
  it("quedan dentro de los rangos cerrados de DEFINICION_ATRIBUTOS", () => {
    for (const [clave, r] of Object.entries(RANGOS_PLAUSIBLES)) {
      const cerrado = DEFINICION_ATRIBUTOS[clave as ClaveAtributo].rango
      expect(cerrado, clave).toBeDefined()
      expect(r![0], clave).toBeGreaterThanOrEqual(cerrado![0])
      expect(r![1], clave).toBeLessThanOrEqual(cerrado![1])
    }
  })
})

describe("fueraDeRango", () => {
  it("marca lo que cae fuera y trae el rango", () => {
    const r = fueraDeRango([
      fila("potencia_w", 30000),
      fila("flujo_lm", 60000),
      fila("tension_v", 2),
      fila("ip", 0),
      fila("potencia_w", 50),
      fila("ip", 65),
    ])
    expect(r.map((h) => `${h.clave}=${h.valorNum}`)).toEqual(["potencia_w=30000", "flujo_lm=60000", "tension_v=2", "ip=0"])
    expect(r[0]).toMatchObject({ min: 0.1, max: 2000 })
  })

  it("ignora las claves de texto, las sin rango y las filas sin valor numérico", () => {
    expect(fueraDeRango([fila("zocalo", null, { valorTexto: "e27" }), fila("color", null), fila("medidas_mm", 99999999)])).toEqual([])
  })

  it("los extremos del rango son válidos", () => {
    expect(fueraDeRango([fila("potencia_w", 0.1), fila("potencia_w", 2000), fila("ip", 10), fila("ip", 68)])).toEqual([])
  })

  it("cuenta por clave", () => {
    const h = fueraDeRango([fila("ip", 0), fila("ip", 1), fila("tension_v", 2)])
    expect(contarFueraDeRango(h)).toEqual({ ip: 2, tension_v: 1 })
  })
})

describe("pareceCable", () => {
  it.each([
    ["CABLE UNIPOLAR 2,5MM NORMALIZADO"],
    ["CABLE TIPO TALLER 2X1.5"],
    ["CONDUCTOR SUBTERRANEO 4X6"],
  ])("sí: %s", (n) => expect(pareceCable(n)).toBe(true))
  it.each([
    ["PRENSACABLE 20MM"],
    ["GRAMPA PARA CABLE 6MM"],
    ["CABLE UTP CAT 6"],
    ["LLAVE TERMICA BIPOLAR 2X25"],
    ["CABLE DE ACERO 4MM"],
    ["LAMPARA 9W E27"],
  ])("no: %s", (n) => expect(pareceCable(n)).toBe(false))
})

describe("cablesSinSeccion", () => {
  const prod = (alegraId: string, name: string) => ({ alegraId, name, description: null, publicado: true })

  it("lista los cables sin fila y el valor que sacaría el extractor", () => {
    const r = cablesSinSeccion(
      [
        prod("1", "CABLE UNIPOLAR 2,5MM"),
        prod("2", "CABLE 3X1.5MM2"),
        prod("3", "CABLE SIN MEDIDA ROLLO 100M"),
        prod("4", "TORNILLO 4MM"),
        prod("5", "CABLE 4MM"),
      ],
      new Set(["2"]),
    )
    expect(r).toEqual([
      { alegraId: "1", nombre: "CABLE UNIPOLAR 2,5MM", seccionDelNombre: 2.5 },
      { alegraId: "3", nombre: "CABLE SIN MEDIDA ROLLO 100M", seccionDelNombre: null },
      { alegraId: "5", nombre: "CABLE 4MM", seccionDelNombre: 4 },
    ])
  })
})

describe("planearBackfillSeccion", () => {
  const prod = (alegraId: string, name: string) => ({ alegraId, name, description: null })

  it("sólo escribe seccion_mm2 con valor del nombre; nuevas, cambios e iguales", () => {
    const plan = planearBackfillSeccion(
      [
        prod("1", "CABLE UNIPOLAR 2,5MM"), // nueva
        prod("2", "CABLE 3X1.5MM2"), // igual
        prod("3", "CABLE 4MM"), // cambia (nombre guardado 6)
        prod("4", "TORNILLO 4MM"), // sin lectura
      ],
      new Map([
        ["2", { fuente: "nombre" as const, valorNum: 1.5 }],
        ["3", { fuente: "nombre" as const, valorNum: 6 }],
      ]),
    )
    expect(plan).toMatchObject({ nuevas: 1, cambian: 1, iguales: 1, protegidas: 0 })
    expect(plan.filas).toEqual([
      { alegraId: "1", clave: "seccion_mm2", valorNum: 2.5, valorTexto: null },
      { alegraId: "3", clave: "seccion_mm2", valorNum: 4, valorTexto: null },
    ])
  })

  it("nunca toca lo que ya tiene fuente pdf o manual (aunque el valor difiera)", () => {
    const plan = planearBackfillSeccion(
      [prod("1", "CABLE 4MM"), prod("2", "CABLE 2,5MM"), prod("3", "CABLE 6MM")],
      new Map([
        ["1", { fuente: "pdf" as const, valorNum: 6 }],
        ["2", { fuente: "manual" as const, valorNum: 2.5 }],
      ]),
    )
    expect(plan).toMatchObject({ nuevas: 1, protegidas: 2, protegidasDistintas: 1 })
    expect(plan.filas.map((f) => f.alegraId)).toEqual(["3"])
  })

  it("es idempotente: aplicar el plan y volver a planear no escribe nada", () => {
    const productos = [prod("1", "CABLE 4MM"), prod("2", "CABLE 3X2,5")]
    const p1 = planearBackfillSeccion(productos, new Map())
    const guardadas = new Map(p1.filas.map((f) => [f.alegraId, { fuente: "nombre" as const, valorNum: f.valorNum }]))
    const p2 = planearBackfillSeccion(productos, guardadas)
    expect(p2.filas).toEqual([])
    expect(p2.iguales).toBe(2)
  })

  it("seccionDeNombre lee la descripción también", () => {
    expect(seccionDeNombre("CABLE UNIPOLAR", "Sección 2,5MM")).toBe(2.5)
  })
})
