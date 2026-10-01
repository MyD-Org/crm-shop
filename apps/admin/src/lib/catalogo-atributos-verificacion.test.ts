import { describe, expect, it } from "vitest"
import {
  consolidar,
  filaCoincideConCodigo,
  normalizarCita,
  numerosDe,
  tokensDelNombre,
  variantesCodigo,
  verificarLectura,
  type ContextoVerificacion,
  type LecturaCruda,
} from "./catalogo-atributos-verificacion"

// Todo ficticio: códigos, nombres y textos inventados para los tests.
const RELLENO = "Descripcion general del producto con caracteristicas tecnicas y condiciones de uso. ".repeat(3)

const TABLA_REFLECTORES = `${RELLENO}
Reflector LED serie RF
Modelo Potencia Flujo luminoso IP Temperatura
RF-10 10W 800LM IP65 6500K
RF-20 20W 1600LM IP65 6500K
RF-30 30W 2400LM IP66 6500K`

function ctx(parte: Partial<ContextoVerificacion> = {}): ContextoVerificacion {
  return { code: "990101001A-XYZ", nombre: "REFLECTOR 20W", textoPaginas: [TABLA_REFLECTORES], unicoProducto: false, ...parte }
}

function lectura(fila: string | null, atributos: LecturaCruda["atributos"]): LecturaCruda {
  return { id: "p1", pdf: "pdfs/reflectores.pdf", fila, atributos }
}

const motivos = (r: ReturnType<typeof verificarLectura>) => r.descartes.map((d) => `${d.clave}:${d.motivo}`)

describe("normalizarCita y numerosDe", () => {
  it("mayúsculas, sin tildes, espacios colapsados y guiones unificados", () => {
    expect(normalizarCita("  Tensión  de  85–265 V ")).toBe("TENSION DE 85-265 V")
    expect(normalizarCita("300 × 1200")).toBe("300 X 1200")
  })
  it("números con coma o punto; miles con separador", () => {
    expect(numerosDe("2,5 MM2 Y 1.200 LM Y 0.75")).toEqual(new Set([2.5, 2, 1.2, 1200, 0.75]))
  })
})

describe("variantesCodigo / filaCoincideConCodigo", () => {
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
  it("prefijo de 2-3 dígitos duplicado en Alegra: prueba también la forma sin repetición", () => {
    expect(variantesCodigo("99990101001A-XYZ")).toEqual(["99990101001A", "990101001A"])
    expect(filaCoincideConCodigo("99 0101001A", "99990101001A-XYZ")).toBe(true)
  })
  it("descarta códigos cortos o sólo numéricos cortos", () => {
    expect(variantesCodigo("AB1-XYZ")).toEqual([])
    expect(variantesCodigo("ABCDE")).toEqual([])
    expect(variantesCodigo("123456")).toEqual([])
    expect(variantesCodigo(null)).toEqual([])
  })
})

describe("tokensDelNombre", () => {
  it("extrae número + unidad y medidas", () => {
    expect(tokensDelNombre("REFLECTOR LED 20W").map((t) => t.token)).toEqual(["20W"])
    expect(tokensDelNombre("GABINETE 300X1200 MM").map((t) => t.token)).toEqual(["300x1200"])
    expect(tokensDelNombre("TERMICA 2X25A 6KA").map((t) => t.token).sort()).toEqual(["25A", "6KA"])
  })
  it("el token 20W no matchea dentro de 120W", () => {
    const [t] = tokensDelNombre("REFLECTOR 20W")
    expect(t.re.test("RF-120 120W")).toBe(false)
    expect(t.re.test("RF-20 20 W")).toBe(true)
  })
})

describe("verificarLectura: caso real que motivó las reglas (REFLECTOR 20W, tabla 10/20/30W)", () => {
  it("el modelo devuelve la fila de 10W: se descarta todo", () => {
    const r = verificarLectura(
      lectura("RF-10", {
        potencia_w: { valor: 10, cita: "RF-10 10W 800LM IP65" },
        flujo_lm: { valor: 800, cita: "RF-10 10W 800LM IP65" },
      }),
      ctx(),
    )
    expect(r.aceptados).toEqual([])
    expect(motivos(r)).toEqual(["potencia_w:fila_no_coincide", "flujo_lm:fila_no_coincide"])
  })

  it("aunque pida la fila de 20W, citar la fila de 10W no pasa", () => {
    const r = verificarLectura(
      lectura("RF-20", { flujo_lm: { valor: 800, cita: "RF-10 10W 800LM IP65" } }),
      ctx(),
    )
    expect(r.aceptados).toEqual([])
    expect(motivos(r)).toEqual(["flujo_lm:fila_fuera_de_cita"])
  })

  it("la fila de 20W se acepta, con su cita", () => {
    const r = verificarLectura(
      lectura("RF-20", {
        potencia_w: { valor: 20, cita: "RF-20 20W 1600LM IP65" },
        flujo_lm: { valor: 1600, cita: "RF-20 20W 1600LM IP65" },
        ip: { valor: 65, cita: "RF-20 20W 1600LM IP65" },
      }),
      ctx(),
    )
    expect(r.descartes).toEqual([])
    expect(r.aceptados.map((a) => [a.clave, a.valorNum])).toEqual([
      ["potencia_w", 20],
      ["flujo_lm", 1600],
      ["ip", 65],
    ])
    expect(r.aceptados[0].cita).toBe("RF-20 20W 1600LM IP65")
  })

  it("si el producto es el de 10W pero el nombre dice 20W, el valor del PDF que contradice el nombre cae", () => {
    // Fila con el código del producto (coincide) pero potencia 10 vs nombre 20W.
    const r = verificarLectura(
      lectura("RF-10", { potencia_w: { valor: 10, cita: "RF-10 10W 800LM IP65" } }),
      ctx({ nombre: "REFLECTOR 20W", code: "RF-10" }),
    )
    expect(motivos(r)).toEqual(["potencia_w:contradice_nombre"])
  })
})

describe("verificarLectura: regla 2, fila", () => {
  it("fila que coincide con el código de Alegra (con espacios intercalados)", () => {
    const texto = `${RELLENO}\nCierre lateral 99 0101001A color negro pintura epoxi`
    const r = verificarLectura(
      lectura("99 0101001A", { color: { valor: "negro", cita: "99 0101001A color negro" } }),
      ctx({ nombre: "CIERRE LATERAL GABINETE", textoPaginas: [texto] }),
    )
    expect(r.descartes).toEqual([])
    expect(r.aceptados[0]).toMatchObject({ clave: "color", valorTexto: "negro" })
  })

  it("fila que no figura en el texto del PDF", () => {
    const r = verificarLectura(lectura("ZZ-99", { potencia_w: { valor: 20, cita: "RF-20 20W" } }), ctx())
    expect(motivos(r)).toEqual(["potencia_w:fila_no_en_texto"])
  })

  it("fila nula: sólo si el PDF es la ficha propia de un producto", () => {
    const texto = `${RELLENO}\nTermica bipolar 2P 25A 6kA curva C`
    const l = lectura(null, { corriente_a: { valor: 25, cita: "2P 25A 6kA" } })
    const compartido = verificarLectura(l, ctx({ nombre: "TERMICA 2X25A", textoPaginas: [texto], unicoProducto: false }))
    expect(motivos(compartido)).toEqual(["corriente_a:fila_ausente"])
    const propio = verificarLectura(l, ctx({ nombre: "TERMICA 2X25A", textoPaginas: [texto], unicoProducto: true }))
    expect(propio.descartes).toEqual([])
    expect(propio.aceptados[0]).toMatchObject({ clave: "corriente_a", valorNum: 25 })
  })

  it("sin código utilizable ni tokens en el nombre, una fila no alcanza", () => {
    const r = verificarLectura(
      lectura("RF-20", { flujo_lm: { valor: 1600, cita: "RF-20 20W 1600LM" } }),
      ctx({ nombre: "REFLECTOR", code: "RF" }),
    )
    expect(motivos(r)).toEqual(["flujo_lm:fila_no_coincide"])
  })
})

describe("verificarLectura: regla 1, evidencia literal", () => {
  const fila = { fila: "RF-20" }
  const c = ctx({ code: "RF-20" })

  it("la cita tiene que aparecer en el texto", () => {
    const r = verificarLectura(lectura(fila.fila, { flujo_lm: { valor: 1600, cita: "RF-20 20W 1700LM" } }), c)
    expect(motivos(r)).toEqual(["flujo_lm:cita_no_en_texto"])
  })

  it("la cita tiene que contener el valor", () => {
    const r = verificarLectura(lectura(fila.fila, { flujo_lm: { valor: 1700, cita: "RF-20 20W 1600LM" } }), c)
    expect(motivos(r)).toEqual(["flujo_lm:valor_no_en_cita"])
  })

  it("número en la cita pero con otra unidad: no alcanza", () => {
    const r = verificarLectura(lectura(fila.fila, { corriente_a: { valor: 20, cita: "RF-20 20W 1600LM" } }), c)
    expect(motivos(r)).toEqual(["corriente_a:unidad_no_en_cita"])
  })

  it("sin cita no se acepta nada", () => {
    const r = verificarLectura(lectura(fila.fila, { potencia_w: { valor: 20, cita: "" }, ip: { valor: 65, cita: null } }), c)
    expect(motivos(r)).toEqual(["potencia_w:cita_ausente", "ip:cita_ausente"])
  })

  it("la normalización de la cita ignora mayúsculas, tildes y espacios", () => {
    const texto = `${RELLENO}\nTensión nominal: 220 V ~ 50 Hz  Código RF-20`
    const r = verificarLectura(
      lectura("RF-20", { tension_v: { valor: 220, cita: "tension   nominal: 220 v ~ 50 hz  codigo rf-20" } }),
      ctx({ code: "RF-20", textoPaginas: [texto] }),
    )
    expect(r.aceptados).toHaveLength(1)
  })

  it("la cita no puede cruzar páginas", () => {
    const r = verificarLectura(
      lectura("RF-20", { potencia_w: { valor: 20, cita: "MODELO RF-20 20W" } }),
      ctx({ code: "RF-20", textoPaginas: [`${RELLENO} MODELO RF-20`, `20W ${RELLENO}`] }),
    )
    expect(motivos(r)).toEqual(["potencia_w:cita_no_en_texto"])
  })

  it("decimales con coma o punto", () => {
    const texto = `${RELLENO}\nCable CB-15 seccion 1,5 mm2 rollo 100 m`
    const base = ctx({ code: "CB-15", nombre: "CABLE UNIPOLAR", textoPaginas: [texto] })
    const r = verificarLectura(
      lectura("CB-15", {
        seccion_mm2: { valor: 1.5, cita: "CB-15 seccion 1,5 mm2" },
        largo_m: { valor: 100, cita: "CB-15 seccion 1,5 mm2 rollo 100 m" },
      }),
      base,
    )
    expect(r.descartes).toEqual([])
    expect(r.aceptados.map((a) => [a.clave, a.valorNum])).toEqual([
      ["seccion_mm2", 1.5],
      ["largo_m", 100],
    ])
  })

  it("rango de tensión y medidas", () => {
    const texto = `${RELLENO}\nGabinete GB-300 dimensiones 300 x 1200 mm alimentacion AC 85-265V`
    const base = ctx({ code: "GB-300", nombre: "GABINETE", textoPaginas: [texto] })
    const r = verificarLectura(
      lectura("GB-300", {
        medidas_mm: { valor: "300x1200", cita: "GB-300 dimensiones 300 x 1200 mm" },
        tension_v: { valor: "85-265", cita: "GB-300 dimensiones 300 x 1200 mm alimentacion AC 85-265V" },
      }),
      base,
    )
    expect(r.descartes).toEqual([])
    expect(r.aceptados.map((a) => [a.clave, a.valorTexto])).toEqual([
      ["medidas_mm", "300x1200"],
      ["tension_v", "85-265"],
    ])
  })

  it("medidas distintas a las de la cita se descartan", () => {
    const texto = `${RELLENO}\nGabinete GB-300 dimensiones 300 x 1200 mm`
    const r = verificarLectura(
      lectura("GB-300", { medidas_mm: { valor: "300x1000", cita: "GB-300 dimensiones 300 x 1200 mm" } }),
      ctx({ code: "GB-300", nombre: "GABINETE", textoPaginas: [texto] }),
    )
    expect(motivos(r)).toEqual(["medidas_mm:valor_no_en_cita"])
  })

  it("IP exige la sigla IP junto al número", () => {
    const texto = `${RELLENO}\nModelo RF-20 grado de proteccion 65 y potencia 20W IP65`
    const base = ctx({ code: "RF-20", nombre: "REFLECTOR", textoPaginas: [texto] })
    expect(verificarLectura(lectura("RF-20", { ip: { valor: 65, cita: "RF-20 grado de proteccion 65" } }), base).descartes[0].motivo).toBe(
      "unidad_no_en_cita",
    )
    expect(verificarLectura(lectura("RF-20", { ip: { valor: 65, cita: "RF-20 grado de proteccion 65 y potencia 20W IP65" } }), base).aceptados).toHaveLength(1)
  })

  it("palabras del vocabulario y sinónimos: color, montaje, curva, tono, zócalo, polos", () => {
    const texto = `${RELLENO}\nPlafon PL-10 color Negra montaje de embutir portalampara E27 luz calida curva C bipolar`
    const base = ctx({ code: "PL-10", nombre: "PLAFON", textoPaginas: [texto] })
    const linea = "PL-10 color Negra montaje de embutir portalampara E27 luz calida curva C bipolar"
    const r = verificarLectura(
      lectura("PL-10", {
        color: { valor: "negro", cita: linea },
        montaje: { valor: "embutir", cita: linea },
        zocalo: { valor: "E27", cita: linea },
        tono: { valor: "calido", cita: linea },
        curva: { valor: "C", cita: linea },
        polos: { valor: 2, cita: linea },
      }),
      base,
    )
    expect(r.descartes).toEqual([])
    expect(new Set(r.aceptados.map((a) => a.clave))).toEqual(new Set(["color", "montaje", "zocalo", "tono", "curva", "polos"]))
  })

  it("'luz blanca' es tono, no color", () => {
    const texto = `${RELLENO}\nLampara LA-10 luz blanca 6500K`
    const r = verificarLectura(
      lectura("LA-10", { color: { valor: "blanco", cita: "LA-10 luz blanca" } }),
      ctx({ code: "LA-10", nombre: "LAMPARA", textoPaginas: [texto] }),
    )
    expect(motivos(r)).toEqual(["color:valor_no_en_cita"])
  })
})

describe("verificarLectura: reglas 3, 4 y 5", () => {
  const texto = `${RELLENO}\nTermica TM-25 bipolar 2P 32A 6kA curva C IP20`
  const base = ctx({ code: "TM-25", nombre: "TERMICA 2X25A", textoPaginas: [texto] })

  it("regla 3: el PDF contradice el nombre", () => {
    const r = verificarLectura(
      lectura("TM-25", {
        corriente_a: { valor: 32, cita: "TM-25 bipolar 2P 32A 6kA" },
        poder_corte_ka: { valor: 6, cita: "TM-25 bipolar 2P 32A 6kA" },
      }),
      base,
    )
    expect(motivos(r)).toEqual(["corriente_a:contradice_nombre"])
    expect(r.aceptados.map((a) => a.clave)).toEqual(["poder_corte_ka"])
  })

  it("regla 3: si coincide con el nombre, se acepta", () => {
    const r = verificarLectura(
      lectura("TM-25", { polos: { valor: 2, cita: "TM-25 bipolar 2P" } }),
      base,
    )
    expect(r.aceptados).toHaveLength(1)
  })

  it("regla 4: PDF sin capa de texto", () => {
    const r = verificarLectura(
      lectura("TM-25", { poder_corte_ka: { valor: 6, cita: "6kA" } }),
      ctx({ textoPaginas: ["", "  ", ""] }),
    )
    expect(motivos(r)).toEqual(["poder_corte_ka:sin_texto"])
    expect(verificarLectura(lectura("TM-25", { ip: { valor: 20, cita: "IP20" } }), ctx({ textoPaginas: null })).descartes[0].motivo).toBe("sin_texto")
  })

  it("regla 5: rangos y vocabularios", () => {
    const t = `${RELLENO}\nTermica TM-25 6 polos curva E color fucsia 5000 A`
    const r = verificarLectura(
      lectura("TM-25", {
        polos: { valor: 6, cita: "6 polos" },
        curva: { valor: "E", cita: "curva E" },
        color: { valor: "fucsia", cita: "color fucsia" },
        corriente_a: { valor: 7000, cita: "5000 A" },
        inventada: { valor: 1, cita: "TM-25" },
      }),
      ctx({ code: "TM-25", nombre: "TERMICA", textoPaginas: [t] }),
    )
    expect(r.aceptados).toEqual([])
    expect(motivos(r)).toEqual([
      "polos:valor_invalido",
      "curva:valor_invalido",
      "color:valor_invalido",
      "corriente_a:valor_invalido",
      "inventada:clave_desconocida",
    ])
  })

  it("un valor con unidad dentro de un string no es un número válido", () => {
    const r = verificarLectura(
      lectura("TM-25", { poder_corte_ka: { valor: "6 kA", cita: "6kA" } }),
      base,
    )
    expect(motivos(r)).toEqual(["poder_corte_ka:valor_invalido"])
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
