import { describe, expect, it } from "vitest"
import {
  consolidar,
  filaCoincideConCodigo,
  normalizarCita,
  numerosDe,
  terminosEn,
  tokensDelNombre,
  variantesCodigo,
  verificarLectura,
  type ContextoVerificacion,
  type LecturaCruda,
} from "./catalogo-atributos-verificacion"
import type { ItemTexto } from "./catalogo-ficha-texto"

// Todo ficticio: códigos, nombres y tablas inventados para los tests.

type Celda = [texto: string, x: number, y: number]
const items = (celdas: Celda[]): ItemTexto[] => celdas.map(([str, x, y]) => ({ str, x, y, w: str.length * 5, h: 9 }))
const RELLENO: Celda = ["Descripcion general del producto con caracteristicas tecnicas y condiciones de uso del equipo.", 40, 800]

/** Tabla NORMAL: una fila por modelo. */
const TABLA_FILAS: Celda[] = [
  RELLENO,
  ["Modelo", 40, 720], ["Potencia", 120, 720], ["Flujo", 200, 720], ["IP", 280, 720],
  ["RF-10", 40, 700], ["10W", 120, 700], ["800LM", 200, 700], ["IP65", 280, 700],
  ["RF-20", 40, 680], ["20W", 120, 680], ["1600LM", 200, 680], ["IP65", 280, 680],
  ["RF-30", 40, 660], ["30W", 120, 660], ["2400LM", 200, 660], ["IP66", 280, 660],
]

/** Tabla TRANSPUESTA: los modelos son encabezados de columna y los rótulos están a la izquierda. */
const TABLA_COLUMNAS: Celda[] = [
  RELLENO,
  ["Modelo", 40, 720], ["EFLG2-10W", 150, 720], ["EFLG2-20W", 250, 720], ["EFLG2-30W", 350, 720],
  ["Potencia", 40, 700], ["10W", 160, 700], ["20W", 260, 700], ["30W", 360, 700],
  ["Flujo luminoso", 40, 680], ["1.100lm", 155, 680], ["2.200lm", 255, 680], ["3.300lm", 355, 680],
  ["IP", 40, 660], ["65", 160, 660], ["65", 260, 660], ["66", 360, 660],
  ["Temperatura", 40, 640], ["3000K", 155, 640], ["3000K", 255, 640], ["6500K", 355, 640],
]

function ctx(celdas: Celda[], parte: Partial<ContextoVerificacion> = {}): ContextoVerificacion {
  return { code: "990101001A-XYZ", nombre: "REFLECTOR 20W", paginas: [items(celdas)], unicoProducto: false, ...parte }
}

function lectura(fila: string | null, atributos: LecturaCruda["atributos"]): LecturaCruda {
  return { id: "p1", pdf: "pdfs/reflectores.pdf", fila, atributos }
}

const motivos = (r: ReturnType<typeof verificarLectura>) => r.descartes.map((d) => `${d.clave}:${d.motivo}`)
const aceptados = (r: ReturnType<typeof verificarLectura>) => r.aceptados.map((a) => [a.clave, a.valorNum ?? a.valorTexto])

describe("normalizarCita, numerosDe y terminosEn", () => {
  it("mayúsculas, sin tildes, espacios colapsados y guiones unificados", () => {
    expect(normalizarCita("  Tensión  de  85–265 V ")).toBe("TENSION DE 85-265 V")
    expect(normalizarCita("300 × 1200")).toBe("300 X 1200")
  })
  it("números con coma o punto; miles con separador", () => {
    expect(numerosDe("2,5 MM2 Y 1.200 LM Y 0.75")).toEqual(new Set([2.5, 2, 1.2, 1200, 0.75]))
  })
  it("valores de una magnitud en un texto", () => {
    expect(terminosEn("flujo_lm", "1.100LM Y 2200 LM")).toEqual(["1100", "2200"])
    expect(terminosEn("tension_v", "200 - 240VCA Y 230V")).toEqual(["200-240", "230"])
    expect(terminosEn("ip", "IP 65 O IP20")).toEqual(["65", "20"])
    expect(terminosEn("medidas_mm", "300 X 1200 MM")).toEqual(["300x1200"])
    expect(terminosEn("color", "COLOR NEGRO")).toEqual(["negro"])
    expect(terminosEn("potencia_w", "20W Y 110LM/W")).toEqual(["20"])
  })
})

describe("variantesCodigo / filaCoincideConCodigo / tokensDelNombre", () => {
  it("quita el sufijo de marca y los separadores", () => {
    expect(variantesCodigo("990101001A-XYZ")).toEqual(["990101001A"])
    expect(filaCoincideConCodigo("99 0101001A", "990101001A-XYZ")).toBe(true)
    expect(filaCoincideConCodigo("99-0101001A", "990101001A-XYZ")).toBe(true)
    expect(filaCoincideConCodigo("990101 001A", "990101001A-XYZ")).toBe(true)
  })
  it("respeta los bordes", () => {
    expect(filaCoincideConCodigo("990101001A5", "990101001A-XYZ")).toBe(false)
    expect(filaCoincideConCodigo("X990101001A", "990101001A-XYZ")).toBe(false)
  })
  it("prefijo de 2-3 dígitos duplicado en Alegra", () => {
    expect(variantesCodigo("99990101001A-XYZ")).toEqual(["99990101001A", "990101001A"])
    expect(filaCoincideConCodigo("99 0101001A", "99990101001A-XYZ")).toBe(true)
  })
  it("la fila ES el código (SKU corto) o es el modelo y el código le agrega variante y marca", () => {
    expect(filaCoincideConCodigo("3537", "3537-ABC")).toBe(true)
    expect(filaCoincideConCodigo("EFLG2-100W", "EFLG2-100W-WW-ABC")).toBe(true)
    expect(filaCoincideConCodigo("EFLG2-10W", "EFLG2-100W-WW-ABC")).toBe(false)
    expect(filaCoincideConCodigo("RF-1", "RF-10-ABC")).toBe(false)
  })
  it("descarta códigos cortos o sólo numéricos cortos", () => {
    expect(variantesCodigo("AB1-XYZ")).toEqual([])
    expect(variantesCodigo("ABCDE")).toEqual([])
    expect(variantesCodigo("123456")).toEqual([])
    expect(variantesCodigo(null)).toEqual([])
  })
  it("tokens número+unidad del nombre", () => {
    expect(tokensDelNombre("REFLECTOR LED 20W").map((t) => t.token)).toEqual(["20W"])
    expect(tokensDelNombre("GABINETE 300X1200 MM").map((t) => t.token)).toEqual(["300x1200"])
    expect(tokensDelNombre("TERMICA 2X25A 6KA").map((t) => t.token).sort()).toEqual(["25A", "6KA"])
    const [t] = tokensDelNombre("REFLECTOR 20W")
    expect(t.re.test("RF-120 120W")).toBe(false)
    expect(t.re.test("RF-20 20 W")).toBe(true)
  })
})

describe("tabla por filas (caso real: REFLECTOR 20W con variantes 10W/20W/30W)", () => {
  it("el modelo devuelve la fila de 10W: se descarta (fila_no_coincide)", () => {
    const r = verificarLectura(lectura("RF-10", { potencia_w: { valor: 10 }, flujo_lm: { valor: 800 } }), ctx(TABLA_FILAS))
    expect(r.aceptados).toEqual([])
    expect(motivos(r)).toEqual(["potencia_w:fila_no_coincide", "flujo_lm:fila_no_coincide"])
  })

  it("pide la fila de 20W pero el valor es de la fila de 10W: valor_fuera_de_fila", () => {
    const r = verificarLectura(lectura("RF-20", { flujo_lm: { valor: 800 } }), ctx(TABLA_FILAS, { code: "RF-20-XYZ" }))
    expect(motivos(r)).toEqual(["flujo_lm:valor_fuera_de_fila"])
  })

  it("la fila de 20W se acepta, y la cita es sólo informativa", () => {
    const r = verificarLectura(
      lectura("RF-20", {
        potencia_w: { valor: 20 },
        flujo_lm: { valor: 1600, cita: "Flujo 1600LM" },
        ip: { valor: 65, cita: "cualquier cosa" },
      }),
      ctx(TABLA_FILAS, { code: "RF-20-XYZ" }),
    )
    expect(r.descartes).toEqual([])
    expect(aceptados(r)).toEqual([["potencia_w", 20], ["flujo_lm", 1600], ["ip", 65]])
    expect(r.aceptados.map((a) => [a.clave, a.regla])).toEqual(expect.arrayContaining([["flujo_lm", "fila"], ["potencia_w", "fila"]]))
    const flujo = r.aceptados.find((a) => a.clave === "flujo_lm")!
    expect(flujo.evidencia).toBe("1600LM")
    expect(flujo.citaEnTexto).toBe(false)
    expect(r.aceptados.find((a) => a.clave === "potencia_w")!.cita).toBeNull()
  })

  it("sin fila, un valor que se repite entre filas no se acepta", () => {
    const r = verificarLectura(lectura(null, { flujo_lm: { valor: 1600 } }), ctx(TABLA_FILAS))
    expect(motivos(r)).toEqual(["flujo_lm:fila_ausente"])
  })

  it("el producto se reconoce por los tokens del nombre aunque la fila no sea su código", () => {
    const r = verificarLectura(lectura("RF-20", { flujo_lm: { valor: 1600 } }), ctx(TABLA_FILAS, { code: "OTRO" }))
    expect(aceptados(r)).toEqual([["flujo_lm", 1600]])
    const mal = verificarLectura(lectura("RF-30", { flujo_lm: { valor: 2400 } }), ctx(TABLA_FILAS, { code: "OTRO" }))
    expect(motivos(mal)).toEqual(["flujo_lm:fila_no_coincide"])
  })

  it("fila que no figura en el PDF", () => {
    const r = verificarLectura(lectura("ZZ-99", { potencia_w: { valor: 20 } }), ctx(TABLA_FILAS))
    expect(motivos(r)).toEqual(["potencia_w:fila_no_en_texto"])
  })
})

describe("tabla transpuesta (los modelos son encabezados de columna)", () => {
  const base = { code: "EFLG2-20W-CW-XYZ" }

  it("acepta los valores de la columna del producto", () => {
    const r = verificarLectura(
      lectura("EFLG2-20W", { potencia_w: { valor: 20 }, flujo_lm: { valor: 2200 }, ip: { valor: 65 }, temperatura_k: { valor: 3000 } }),
      ctx(TABLA_COLUMNAS, { ...base, nombre: "REFLECTOR LED 20W" }),
    )
    expect(r.descartes).toEqual([])
    expect(aceptados(r)).toEqual(expect.arrayContaining([["potencia_w", 20], ["flujo_lm", 2200], ["ip", 65], ["temperatura_k", 3000]]))
  })

  it("el reflector 20W con valores de 10W en otra columna: se descarta", () => {
    // El modelo pide la columna correcta pero toma el flujo de la de 10W...
    const a = verificarLectura(lectura("EFLG2-20W", { flujo_lm: { valor: 1100 } }), ctx(TABLA_COLUMNAS, { ...base, nombre: "REFLECTOR LED 20W" }))
    expect(motivos(a)).toEqual(["flujo_lm:valor_fuera_de_fila"])
    // ...o directamente pide la columna de 10W.
    const b = verificarLectura(lectura("EFLG2-10W", { flujo_lm: { valor: 1100 }, potencia_w: { valor: 10 } }), ctx(TABLA_COLUMNAS, { ...base, nombre: "REFLECTOR LED 20W" }))
    expect(motivos(b)).toEqual(["flujo_lm:fila_no_coincide", "potencia_w:fila_no_coincide"])
  })

  it("el número de la celda vecina no se presta a la nuestra", () => {
    // 1.100lm es de la columna de 10W y queda justo a la izquierda de 2.200lm.
    const r = verificarLectura(lectura("EFLG2-20W", { flujo_lm: { valor: 1100 } }), ctx(TABLA_COLUMNAS, { ...base, nombre: "REFLECTOR LED 20W" }))
    expect(r.aceptados).toEqual([])
  })

  it("rótulo + celda separados: IP / 65", () => {
    const r = verificarLectura(lectura("EFLG2-30W", { ip: { valor: 66 } }), ctx(TABLA_COLUMNAS, { code: "EFLG2-30W-XYZ", nombre: "REFLECTOR LED 30W" }))
    expect(aceptados(r)).toEqual([["ip", 66]])
    expect(r.aceptados[0].evidencia).toBe("IP 66")
  })

  it("tabla transpuesta de una sola columna: los valores están debajo del identificador", () => {
    const celdas: Celda[] = [RELLENO, ["SKU", 40, 720], ["3537", 150, 720], ["Potencia", 40, 700], ["65w", 150, 700], ["IP", 40, 680], ["20", 150, 680], ["Potencia", 40, 300], ["45w", 150, 300]]
    const c = ctx(celdas, { code: "3537-ABC", nombre: "ALUMBRADO 65W" })
    expect(aceptados(verificarLectura(lectura("3537", { potencia_w: { valor: 65 } }), c))).toEqual([["potencia_w", 65]])
    expect(aceptados(verificarLectura(lectura("3537", { ip: { valor: 20 } }), c))).toEqual([["ip", 20]])
  })
})

describe("ficha propia de un producto", () => {
  const FICHA: Celda[] = [
    RELLENO,
    ["Tension", 40, 700], ["DC48V", 150, 700],
    ["IP", 40, 680], ["20", 150, 680],
    ["Temperatura", 40, 660], ["3000 K - 6500 K", 150, 660],
    ["Color", 40, 640], ["Negro", 150, 640],
  ]
  const propia = (parte: Partial<ContextoVerificacion> = {}) => ctx(FICHA, { unicoProducto: true, nombre: "COLGANTE", code: "CG-001-XYZ", ...parte })

  it("valor único de su magnitud: se acepta sin fila", () => {
    const r = verificarLectura(lectura(null, { tension_v: { valor: 48 }, ip: { valor: 20 }, color: { valor: "negro" } }), propia())
    expect(r.descartes).toEqual([])
    expect(r.aceptados.map((a) => [a.clave, a.regla])).toEqual([["tension_v", "unico"], ["ip", "unico"], ["color", "vocabulario"]])
  })

  it("varios valores de la misma magnitud: hace falta la fila", () => {
    const r = verificarLectura(lectura(null, { temperatura_k: { valor: 3000 } }), propia())
    expect(motivos(r)).toEqual(["temperatura_k:fila_ausente"])
  })

  it("en un PDF compartido el valor único no alcanza (salvo vocabulario)", () => {
    const r = verificarLectura(lectura(null, { tension_v: { valor: 48 }, color: { valor: "negro" } }), propia({ unicoProducto: false }))
    expect(motivos(r)).toEqual(["tension_v:fila_ausente"])
    expect(aceptados(r)).toEqual([["color", "negro"]])
  })

  it("vocabulario con más de un término: tiene que estar en la fila del producto", () => {
    const celdas: Celda[] = [RELLENO, ["PL-10", 40, 700], ["Negro", 150, 700], ["PL-20", 40, 680], ["Blanco", 150, 680]]
    const c = ctx(celdas, { code: "PL-20-XYZ", nombre: "PLAFON" })
    expect(motivos(verificarLectura(lectura(null, { color: { valor: "blanco" } }), c))).toEqual(["color:fila_ausente"])
    expect(aceptados(verificarLectura(lectura("PL-20", { color: { valor: "blanco" } }), c))).toEqual([["color", "blanco"]])
    expect(motivos(verificarLectura(lectura("PL-20", { color: { valor: "negro" } }), c))).toEqual(["color:valor_fuera_de_fila"])
  })
})

describe("evidencia del valor", () => {
  const celdas: Celda[] = [RELLENO, ["RF-20", 40, 700], ["20W", 120, 700], ["25mm", 200, 700], ["Cable seccion 2,5 mm2", 300, 700], ["luz blanca", 400, 700]]
  const c = ctx(celdas, { unicoProducto: true, code: "RF-20-XYZ", nombre: "REFLECTOR" })

  it("el valor tiene que estar en el texto", () => {
    expect(motivos(verificarLectura(lectura("RF-20", { potencia_w: { valor: 25 } }), c))).toEqual(["potencia_w:unidad_no_en_texto"])
    expect(motivos(verificarLectura(lectura("RF-20", { flujo_lm: { valor: 1700 } }), c))).toEqual(["flujo_lm:valor_no_en_texto"])
  })

  it("decimales con coma o punto", () => {
    expect(aceptados(verificarLectura(lectura(null, { seccion_mm2: { valor: 2.5 } }), c))).toEqual([["seccion_mm2", 2.5]])
  })

  it("'luz blanca' es tono, no color", () => {
    expect(motivos(verificarLectura(lectura(null, { color: { valor: "blanco" } }), c))).toEqual(["color:valor_no_en_texto"])
  })

  it("medidas y rango de tensión", () => {
    const t: Celda[] = [RELLENO, ["Dimensiones", 40, 700], ["300 x 1200 mm", 150, 700], ["AC 85-265V", 150, 680]]
    const r = verificarLectura(lectura(null, { medidas_mm: { valor: "300x1200" }, tension_v: { valor: "85-265" } }), ctx(t, { unicoProducto: true }))
    expect(r.descartes).toEqual([])
    expect(r.aceptados.map((a) => a.valorTexto)).toEqual(expect.arrayContaining(["300x1200", "85-265"]))
  })

  it("la eficiencia lm/W no cuenta como potencia ni como flujo", () => {
    const t: Celda[] = [RELLENO, ["Potencia", 40, 700], ["36w", 150, 700], ["Eficiencia", 40, 680], ["90 Lm/Watt", 150, 680]]
    const r = verificarLectura(lectura(null, { potencia_w: { valor: 36 }, flujo_lm: { valor: 90 } }), ctx(t, { unicoProducto: true, nombre: "LAMPARA" }))
    expect(aceptados(r)).toEqual([["potencia_w", 36]])
    expect(motivos(r)).toEqual(["flujo_lm:valor_no_en_texto"])
  })
})

describe("cruce con el nombre, texto y rangos", () => {
  const celdas: Celda[] = [RELLENO, ["Termica bipolar", 40, 700], ["2P", 150, 700], ["32A", 200, 700], ["6kA", 250, 700], ["curva C", 300, 700]]
  const propia = ctx(celdas, { unicoProducto: true, nombre: "TERMICA 2X25A", code: "TM-25-XYZ" })

  it("el PDF contradice el nombre: se descarta; si coincide, se acepta", () => {
    const r = verificarLectura(lectura(null, { corriente_a: { valor: 32 }, poder_corte_ka: { valor: 6 }, polos: { valor: 2 } }), propia)
    expect(motivos(r)).toEqual(["corriente_a:contradice_nombre"])
    expect(r.aceptados.map((a) => a.clave)).toEqual(["poder_corte_ka", "polos"])
  })

  it("sin capa de texto", () => {
    expect(motivos(verificarLectura(lectura(null, { poder_corte_ka: { valor: 6 } }), ctx([["", 0, 0]], { unicoProducto: true })))).toEqual(["poder_corte_ka:sin_texto"])
    expect(motivos(verificarLectura(lectura(null, { ip: { valor: 20 } }), { ...propia, paginas: null }))).toEqual(["ip:sin_texto"])
    expect(motivos(verificarLectura(lectura(null, { ip: { valor: 20 } }), { ...propia, paginas: [[], []] }))).toEqual(["ip:sin_texto"])
  })

  it("rangos y vocabularios", () => {
    const r = verificarLectura(
      lectura(null, { polos: { valor: 6 }, curva: { valor: "E" }, color: { valor: "fucsia" }, corriente_a: { valor: 70000 }, inventada: { valor: 1 }, poder_corte_ka: { valor: "6 kA" } }),
      propia,
    )
    expect(r.aceptados).toEqual([])
    expect(motivos(r)).toEqual([
      "polos:valor_invalido",
      "curva:valor_invalido",
      "color:valor_invalido",
      "corriente_a:valor_invalido",
      "inventada:clave_desconocida",
      "poder_corte_ka:valor_invalido",
    ])
  })

  it("curva y zócalo por vocabulario", () => {
    const t: Celda[] = [RELLENO, ["Curva", 40, 700], ["C", 150, 700], ["Portalamparas", 40, 680], ["E-27", 150, 680]]
    const r = verificarLectura(lectura(null, { zocalo: { valor: "E27" } }), ctx(t, { unicoProducto: true }))
    expect(aceptados(r)).toEqual([["zocalo", "e27"]])
  })
})

describe("consolidar", () => {
  const a = (id: string, v: number) => ({ id, clave: "polos" as const, valorNum: v, valorTexto: null })
  it("misma respuesta repetida: queda una; respuestas distintas: conflicto", () => {
    const r = consolidar([a("1", 2), a("1", 2), a("2", 2), a("2", 3)])
    expect(r.aceptados).toEqual([a("1", 2)])
    expect(r.conflictos).toEqual([a("2", 2), a("2", 3)])
  })
})
