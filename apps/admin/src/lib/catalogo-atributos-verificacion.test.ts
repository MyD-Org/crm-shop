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
    const celdas: Celda[] = [RELLENO, ["SKU", 40, 720], ["3537", 150, 720], ["Potencia", 40, 700], ["65w", 150, 700], ["IP", 40, 680], ["20", 150, 680], ["Potencia", 40, 300], ["45w", 400, 300]]
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
    const celdas: Celda[] = [RELLENO, ["Temperatura", 40, 660], ["3000K", 150, 660], ["Temperatura", 40, 640], ["6500K", 150, 640]]
    const r = verificarLectura(lectura(null, { temperatura_k: { valor: 3000 } }), ctx(celdas, { unicoProducto: true, nombre: "COLGANTE", code: "CG-001-XYZ" }))
    expect(motivos(r)).toEqual(["temperatura_k:fila_ausente"])
  })

  it("un valor que es extremo de un rango no se acepta", () => {
    const r = verificarLectura(lectura(null, { temperatura_k: { valor: 3000 } }), propia())
    expect(motivos(r)).toEqual(["temperatura_k:valor_en_rango_o_lista"])
  })

  it("en un PDF compartido el valor único no alcanza, tampoco el vocabulario", () => {
    const r = verificarLectura(lectura(null, { tension_v: { valor: 48 }, color: { valor: "negro" } }), propia({ unicoProducto: false }))
    expect(motivos(r)).toEqual(["tension_v:fila_ausente", "color:fila_ausente"])
    expect(aceptados(r)).toEqual([])
  })

  it("vocabulario con más de un término: tiene que estar en la fila del producto", () => {
    const celdas: Celda[] = [RELLENO, ["PL-10", 40, 700], ["Negro", 150, 700], ["PL-20", 40, 680], ["Blanco", 150, 680]]
    const c = ctx(celdas, { code: "PL-20-XYZ", nombre: "PLAFON" })
    expect(motivos(verificarLectura(lectura(null, { color: { valor: "blanco" } }), c))).toEqual(["color:fila_ausente"])
    expect(aceptados(verificarLectura(lectura("PL-20", { color: { valor: "blanco" } }), c))).toEqual([["color", "blanco"]])
    expect(motivos(verificarLectura(lectura("PL-20", { color: { valor: "negro" } }), c))).toEqual(["color:termino_fuera_de_fila"])
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

describe("ambigüedad en la fila/columna (subcolumnas cálido/frío)", () => {
  const SUBCOLUMNAS: Celda[] = [
    RELLENO,
    ["Modelo", 40, 720], ["EFLG2-20W", 250, 720], ["EFLG2-30W", 400, 720],
    ["Tipo", 40, 700], ["Cálido", 235, 700], ["Frío", 300, 700], ["Cálido", 385, 700], ["Frío", 450, 700],
    ["Flujo", 40, 680], ["1100lm", 240, 680], ["1200lm", 300, 680], ["1650lm", 390, 680], ["1800lm", 455, 680],
    ["Temperatura", 40, 660], ["3000K", 240, 660], ["6500K", 300, 660], ["3000K", 390, 660], ["6500K", 455, 660],
    ["Potencia", 40, 640], ["20W", 260, 640], ["30W", 410, 640],
  ]
  const producto = (nombre: string) => ctx(SUBCOLUMNAS, { code: "EFLG2-20W-WW-XYZ", nombre })

  it("el nombre dice la temperatura y coincide con el encabezado de la subcolumna: se acepta", () => {
    const r = verificarLectura(lectura("EFLG2-20W", { flujo_lm: { valor: 1100 }, temperatura_k: { valor: 3000 }, potencia_w: { valor: 20 } }), producto("REFLECTOR LED 20W 3000K"))
    expect(r.descartes).toEqual([])
    expect(r.aceptados.map((a) => a.clave).sort()).toEqual(["flujo_lm", "potencia_w", "temperatura_k"])
  })

  it("el valor es de la otra subcolumna: se descarta", () => {
    const r = verificarLectura(lectura("EFLG2-20W", { flujo_lm: { valor: 1200 } }), producto("REFLECTOR LED 20W 3000K"))
    expect(r.aceptados).toEqual([])
    expect(motivos(r)).toEqual(["flujo_lm:ambiguo_en_fila"])
  })

  it("el nombre no dice temperatura ni tono: ambiguo_en_fila", () => {
    const r = verificarLectura(lectura("EFLG2-20W", { flujo_lm: { valor: 1100 }, temperatura_k: { valor: 3000 } }), producto("REFLECTOR LED 20W"))
    expect(motivos(r)).toEqual(["flujo_lm:ambiguo_en_fila", "temperatura_k:ambiguo_en_fila"])
  })

  it("el nombre dice sólo el tono ('CALIDO'): alcanza si el encabezado es cálido", () => {
    expect(aceptados(verificarLectura(lectura("EFLG2-20W", { flujo_lm: { valor: 1100 } }), producto("REFLECTOR LED 20W CALIDO")))).toEqual([["flujo_lm", 1100]])
    expect(motivos(verificarLectura(lectura("EFLG2-20W", { flujo_lm: { valor: 1200 } }), producto("REFLECTOR LED 20W CALIDO")))).toEqual(["flujo_lm:ambiguo_en_fila"])
  })

  it("un solo valor en la columna no es ambiguo", () => {
    const r = verificarLectura(lectura("EFLG2-20W", { potencia_w: { valor: 20 } }), producto("REFLECTOR LED 20W"))
    expect(aceptados(r)).toEqual([["potencia_w", 20]])
  })
})

describe("valor único en ficha propia con varias páginas", () => {
  const pag = (celdas: Celda[]) => items(celdas)
  const base = { unicoProducto: true, code: "CG-001-XYZ", nombre: "COLGANTE" }

  it("se acepta si está en la página donde figura el producto", () => {
    const paginas = [pag([RELLENO, ["Codigo CG-001", 40, 700], ["DC48V", 150, 700]]), pag([RELLENO, ["Garantia 2 anos", 40, 700]])]
    const r = verificarLectura(lectura(null, { tension_v: { valor: 48 } }), { ...base, paginas })
    expect(aceptados(r)).toEqual([["tension_v", 48]])
    expect(r.aceptados[0].pagina).toBe(1)
  })

  it("el valor único está en otra página: valor_en_otra_pagina", () => {
    const paginas = [pag([RELLENO, ["Codigo CG-001", 40, 700]]), pag([RELLENO, ["Tension", 40, 700], ["DC48V", 150, 700]])]
    expect(motivos(verificarLectura(lectura(null, { tension_v: { valor: 48 } }), { ...base, paginas }))).toEqual(["tension_v:valor_en_otra_pagina"])
  })

  it("producto no ubicado en ninguna página: sólo se acepta si el PDF tiene una página", () => {
    const sin = [pag([RELLENO, ["Tension", 40, 700], ["DC48V", 150, 700]]), pag([RELLENO, ["Garantia 2 anos", 40, 700]])]
    expect(motivos(verificarLectura(lectura(null, { tension_v: { valor: 48 } }), { ...base, paginas: sin }))).toEqual(["tension_v:producto_no_ubicado"])
    expect(aceptados(verificarLectura(lectura(null, { tension_v: { valor: 48 } }), { ...base, paginas: [sin[0]] }))).toEqual([["tension_v", 48]])
  })

  it("también se ubica por los tokens número+unidad del nombre", () => {
    const paginas = [pag([RELLENO, ["Lampara 12W", 40, 700], ["DC48V", 150, 700]]), pag([RELLENO, ["Garantia 2 anos", 40, 700]])]
    const r = verificarLectura(lectura(null, { tension_v: { valor: 48 } }), { ...base, nombre: "LAMPARA 12W", code: null, paginas })
    expect(aceptados(r)).toEqual([["tension_v", 48]])
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

describe("fila = código de Alegra con sufijo de marca", () => {
  const TABLA: Celda[] = [
    RELLENO,
    ["Codigo", 40, 720], ["Potencia", 120, 720], ["Flujo", 200, 720],
    ["ABC123", 40, 700], ["10W", 120, 700], ["800LM", 200, 700],
    ["ABC124", 40, 680], ["20W", 120, 680], ["1600LM", 200, 680],
  ]

  it("la fila viene con el sufijo de marca y se busca sin él", () => {
    const r = verificarLectura(lectura("ABC123-XYZ", { potencia_w: { valor: 10 }, flujo_lm: { valor: 800 } }), ctx(TABLA, { code: "ABC123-XYZ", nombre: "REFLECTOR" }))
    expect(r.descartes).toEqual([])
    expect(aceptados(r)).toEqual([["potencia_w", 10], ["flujo_lm", 800]])
  })

  it("con separadores opcionales en el PDF", () => {
    const t: Celda[] = [RELLENO, ["ABC-123", 40, 700], ["10W", 120, 700], ["ABC-124", 40, 680], ["20W", 120, 680]]
    const r = verificarLectura(lectura("ABC123-XYZ", { potencia_w: { valor: 10 } }), ctx(t, { code: "ABC123-XYZ", nombre: "REFLECTOR" }))
    expect(aceptados(r)).toEqual([["potencia_w", 10]])
  })

  it("prefijo duplicado en Alegra", () => {
    const t: Celda[] = [RELLENO, ["990101001A", 40, 700], ["10W", 120, 700], ["990101002A", 40, 680], ["20W", 120, 680]]
    const r = verificarLectura(lectura("99990101001A-XYZ", { potencia_w: { valor: 10 } }), ctx(t, { code: "99990101001A-XYZ", nombre: "REFLECTOR" }))
    expect(r.descartes).toEqual([])
    expect(aceptados(r)).toEqual([["potencia_w", 10]])
    const otro = verificarLectura(lectura("99990101009A-XYZ", { potencia_w: { valor: 10 } }), ctx(t, { code: "99990101009A-XYZ", nombre: "REFLECTOR" }))
    expect(motivos(otro)).toEqual(["potencia_w:fila_no_en_texto"])
  })

  it("el rigor sigue: valor de otra fila, fila ausente y fila de otro código", () => {
    const c = ctx(TABLA, { code: "ABC123-XYZ", nombre: "REFLECTOR" })
    expect(motivos(verificarLectura(lectura("ABC123-XYZ", { potencia_w: { valor: 20 } }), c))).toEqual(["potencia_w:valor_fuera_de_fila"])
    expect(motivos(verificarLectura(lectura("ABC999-XYZ", { potencia_w: { valor: 10 } }), c))).toEqual(["potencia_w:fila_no_en_texto"])
    expect(motivos(verificarLectura(lectura("ABC124", { potencia_w: { valor: 20 } }), c))).toEqual(["potencia_w:fila_no_coincide"])
  })
})

describe("montaje: superficie / sobrepuesto equivalen a aplicar", () => {
  const t = (txt: string): Celda[] => [RELLENO, ["Montaje", 40, 700], [txt, 120, 700]]
  const c = (txt: string) => ctx(t(txt), { nombre: "PLAFON", unicoProducto: true })
  it.each(["De superficie", "Superficie", "Sobrepuesto"])("%s", (txt) => {
    expect(terminosEn("montaje", txt.toUpperCase())).toEqual(["aplicar"])
    expect(aceptados(verificarLectura(lectura(null, { montaje: { valor: "aplicar" } }), c(txt)))).toEqual([["montaje", "aplicar"]])
  })
  it("no vale para embutir ni se confunde con otra palabra", () => {
    expect(motivos(verificarLectura(lectura(null, { montaje: { valor: "embutir" } }), c("De superficie")))).toEqual(["montaje:valor_no_en_texto"])
    expect(terminosEn("montaje", "SUPERFICIES PLANAS")).toEqual([])
  })
})

describe("vocabulario en un catálogo compartido", () => {
  // "superficie" aparece sólo en la descripción general y en un accesorio, no en la fila de la caja.
  const CATALOGO: Celda[] = [
    RELLENO,
    ["Accesorio: caja de superficie para capsulada", 40, 780],
    ["CJ-16", 40, 700], ["16 modulos", 150, 700],
    ["CJ-32", 40, 680], ["32 modulos", 150, 680],
  ]
  const c = (parte: Partial<ContextoVerificacion> = {}) => ctx(CATALOGO, { code: "CJ-16-XYZ", nombre: "CAJA", ...parte })

  it("termino_fuera_de_fila aunque sea el único término del PDF", () => {
    expect(motivos(verificarLectura(lectura("CJ-16", { montaje: { valor: "aplicar" } }), c()))).toEqual(["montaje:termino_fuera_de_fila"])
  })
  it("sin fila se descarta", () => {
    expect(motivos(verificarLectura(lectura(null, { montaje: { valor: "aplicar" } }), c()))).toEqual(["montaje:fila_ausente"])
  })
  it("en la ficha de un solo producto sigue valiendo el único término", () => {
    expect(aceptados(verificarLectura(lectura(null, { montaje: { valor: "aplicar" } }), c({ unicoProducto: true })))).toEqual([["montaje", "aplicar"]])
  })
  it("si el término está en la fila del producto se acepta", () => {
    const t: Celda[] = [RELLENO, ["CJ-16", 40, 700], ["De superficie", 150, 700], ["CJ-32", 40, 680], ["Embutir", 150, 680]]
    const r = verificarLectura(lectura("CJ-16", { montaje: { valor: "aplicar" } }), ctx(t, { code: "CJ-16-XYZ", nombre: "CAJA" }))
    expect(r.descartes).toEqual([])
    expect(r.aceptados.map((a) => [a.clave, a.valorTexto, a.regla])).toEqual([["montaje", "aplicar", "fila"]])
  })
})

describe("rangos y listas numéricas", () => {
  const una = (txt: string, clave: string, valor: number, extra: Partial<ContextoVerificacion> = {}) =>
    verificarLectura(lectura(null, { [clave]: { valor } }), ctx([RELLENO, ["Dato", 40, 700], [txt, 120, 700]], { unicoProducto: true, nombre: "X", ...extra }))

  it.each([
    ["Flujo 1.400-1.500 Lm", "flujo_lm", 1400],
    ["Flujo 1.400 - 1.500 Lm", "flujo_lm", 1500],
    ["Flujo 1400~1500 Lm", "flujo_lm", 1400],
    ["Flujo 2.050 / 2.100 Lm", "flujo_lm", 2100],
    ["Temperatura 3000/4000/6500K", "temperatura_k", 4000],
    ["Temperatura 3000/4000/6500K", "temperatura_k", 6500],
    ["10W-20W", "potencia_w", 20],
  ])("%s (%s=%d) se descarta", (txt, clave, valor) => {
    expect(motivos(una(txt, clave, valor))).toEqual([`${clave}:valor_en_rango_o_lista`])
  })

  it("un valor suelto y un código de modelo no son rango", () => {
    expect(aceptados(una("1.400 Lm", "flujo_lm", 1400))).toEqual([["flujo_lm", 1400]])
    expect(aceptados(una("Modelo EFLG2-20W 20W", "potencia_w", 20))).toEqual([["potencia_w", 20]])
  })

  it("dos magnitudes distintas con barra no son una lista", () => {
    expect(aceptados(una("Transf. 380/24Vca 50W / 2A", "potencia_w", 50))).toEqual([["potencia_w", 50]])
    expect(aceptados(una("Transf. 12W/0,5A", "potencia_w", 12))).toEqual([["potencia_w", 12]])
    expect(aceptados(una("Transf. 12W/0,5A Corriente", "corriente_a", 0.5))).toEqual([["corriente_a", 0.5]])
  })

  it("lista alineada en columnas: cada valor bajo su propio identificador", () => {
    const r = verificarLectura(lectura("RF-20", { flujo_lm: { valor: 1600 } }), ctx(TABLA_FILAS, { code: "RF-20-XYZ" }))
    expect(aceptados(r)).toEqual([["flujo_lm", 1600]])
  })
})

describe("tension_v: token completo", () => {
  const t = (txt: string, valor: unknown) =>
    verificarLectura(lectura(null, { tension_v: { valor } }), ctx([RELLENO, ["Tension", 40, 700], [txt, 120, 700]], { unicoProducto: true, nombre: "X" }))

  it("un 220 suelto contra un rango es tension_parcial", () => {
    expect(motivos(t("220-240V", 220))).toEqual(["tension_v:tension_parcial"])
    expect(motivos(t("200 - 240VCa", 240))).toEqual(["tension_v:tension_parcial"])
    expect(motivos(t("230/400V", 230))).toEqual(["tension_v:tension_parcial"])
  })
  it("el rango completo se acepta", () => {
    expect(t("220-240V", "220-240").aceptados.map((a) => a.valorTexto)).toEqual(["220-240"])
    expect(t("200 - 240VCa", "200-240").aceptados.map((a) => a.valorTexto)).toEqual(["200-240"])
  })
  it("un rango distinto del del PDF no se acepta", () => {
    expect(motivos(t("200-240VCa", "220-240"))).toEqual(["tension_v:valor_no_en_texto"])
  })
  it("tensión simple", () => {
    expect(aceptados(t("230V", 230))).toEqual([["tension_v", 230]])
  })
})

describe("unidad con borde exacto", () => {
  const una = (txt: string, clave: string, valor: number) =>
    verificarLectura(lectura(null, { [clave]: { valor } }), ctx([RELLENO, ["Dato", 40, 700], [txt, 120, 700]], { unicoProducto: true, nombre: "X" }))

  it.each([
    ["Corriente 36 mA", "corriente_a", 36],
    ["Corriente 36 kA", "corriente_a", 36],
    ["Corriente 36 Ah", "corriente_a", 36],
    ["Potencia 36 Wh", "potencia_w", 36],
    ["Potencia 36 kWh", "potencia_w", 36],
    ["Tension 36 VA", "tension_v", 36],
    ["Flujo 36 lm/W", "flujo_lm", 36],
  ])("%s no vale para %s=%d", (txt, clave, valor) => {
    expect(aceptados(una(txt, clave, valor))).toEqual([])
    expect(motivos(una(txt, clave, valor))).toHaveLength(1)
  })

  it("la unidad correcta sí, con o sin palabra clave", () => {
    expect(aceptados(una("Corriente 36 A", "corriente_a", 36))).toEqual([["corriente_a", 36]])
    expect(aceptados(una("Corriente 36", "corriente_a", 36))).toEqual([["corriente_a", 36]])
    expect(aceptados(una("Potencia 36 W", "potencia_w", 36))).toEqual([["potencia_w", 36]])
  })

  it.each([
    ["Potencia 14 W/m", "potencia_w", 14],
    ["Potencia 14W/m", "potencia_w", 14],
    ["Corriente 2 A x m", "corriente_a", 2],
    ["Flujo 1200 lm/m", "flujo_lm", 1200],
    ["Flujo 1200 LM POR METRO", "flujo_lm", 1200],
  ])("%s es por metro", (txt, clave, valor) => {
    expect(motivos(una(txt, clave, valor))).toEqual([`${clave}:valor_por_metro`])
  })
})

describe("tono = tipo de luz: luces de color", () => {
  const ficha = (celdas: Celda[]) => ctx([RELLENO, ...celdas], { unicoProducto: true, nombre: "TIRA LED 5M", code: "TL-001-XYZ" })

  it("acepta el color de luz con sus sinónimos de género", () => {
    for (const [texto, valor] of [["Luz roja", "rojo"], ["Luz rojo", "rojo"], ["Color de luz: Amarilla", "amarillo"], ["Luz amarillo", "amarillo"], ["Luz verde", "verde"], ["RGB", "rgb"], ["RGBW", "rgbw"]] as const) {
      const r = verificarLectura(lectura(null, { tono: { valor } }), ficha([["Luz", 40, 700], [texto, 150, 700]]))
      expect(r.descartes, texto).toEqual([])
      expect(aceptados(r), texto).toEqual([["tono", valor]])
    }
  })

  it("un color de luz exige rótulo de luz en la celda o en la fila", () => {
    const luz = (celdas: Celda[]) => verificarLectura(lectura(null, { tono: { valor: "verde" } }), ficha(celdas))
    expect(aceptados(luz([["Tipo de luz: Verde", 150, 700]]))).toEqual([["tono", "verde"]])
    expect(aceptados(luz([["Tipo de luz", 40, 700], ["Verde", 150, 700]]))).toEqual([["tono", "verde"]])
    expect(motivos(luz([["Color: Verde", 150, 700]]))).toEqual(["tono:tono_sin_rotulo_de_luz"])
    expect(motivos(luz([["Color", 40, 700], ["Verde", 150, 700]]))).toEqual(["tono:tono_sin_rotulo_de_luz"])
    const rojo = verificarLectura(lectura(null, { tono: { valor: "rojo" } }), ficha([["Color del cuerpo: Rojo", 150, 700]]))
    expect(motivos(rojo)).toEqual(["tono:tono_sin_rotulo_de_luz"])
  })

  it("RGB se acepta sin rótulo de luz y los blancos no cambian", () => {
    expect(aceptados(verificarLectura(lectura(null, { tono: { valor: "rgb" } }), ficha([["Modelo", 40, 700], ["RGB", 150, 700]])))).toEqual([["tono", "rgb"]])
    expect(aceptados(verificarLectura(lectura(null, { tono: { valor: "calido" } }), ficha([["Color", 40, 700], ["Cálido", 150, 700]])))).toEqual([["tono", "calido"]])
  })

  it("RGB no avala RGBW ni al revés; otro color tampoco", () => {
    const solo = ficha([["Luz", 40, 700], ["RGB", 150, 700]])
    expect(motivos(verificarLectura(lectura(null, { tono: { valor: "rgbw" } }), solo))).toEqual(["tono:valor_no_en_texto"])
    expect(motivos(verificarLectura(lectura(null, { tono: { valor: "verde" } }), solo))).toEqual(["tono:valor_no_en_texto"])
  })
})
