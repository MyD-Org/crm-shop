import { describe, expect, it } from "vitest"
import {
  CLAVES_ATRIBUTO,
  DEFINICION_ATRIBUTOS,
  TONOS,
  extraerAtributosDeNombre,
  normalizarAtributos,
  parsearEdicionManual,
  tonoDeKelvin,
  type AtributoExtraido,
} from "./catalogo-atributos-extraccion"

/** Mapa clave → valor (número o texto) para comparar cómodo. */
function comoMapa(atributos: AtributoExtraido[]): Record<string, number | string> {
  return Object.fromEntries(atributos.map((a) => [a.clave, a.valorNum ?? a.valorTexto ?? ""]))
}

const extraer = (nombre: string, descripcion?: string) => comoMapa(extraerAtributosDeNombre(nombre, descripcion))

describe("extraerAtributosDeNombre: nombres reales del catálogo", () => {
  it("REFLECTOR LED 50W CALIDO", () => {
    expect(extraer("REFLECTOR LED 50W CALIDO")).toEqual({ potencia_w: 50, tono: "calido" })
  })

  it("PANEL PLAFON CUADRADO 12W AC85-265V CALIDO 3000K", () => {
    const a = extraerAtributosDeNombre("PANEL PLAFON CUADRADO 12W AC85-265V CALIDO 3000K")
    // El plafón se aplica (montaje por familia del nombre).
    expect(comoMapa(a)).toEqual({ potencia_w: 12, tension_v: 220, tono: "calido", temperatura_k: 3000, montaje: "aplicar" })
    // El rango de entrada se conserva en el texto; el número es el nominal (220 cae dentro).
    expect(a.find((x) => x.clave === "tension_v")).toEqual({ clave: "tension_v", valorNum: 220, valorTexto: "85-265" })
  })

  it("TIRA 5050 BCO FRIO IP20: el 5050 (chip) no es kelvin ni lúmenes", () => {
    expect(extraer("TIRA 5050 BCO FRIO IP20")).toEqual({ tono: "frio", ip: 20 })
  })

  it("TORTUGA LED 12W, 1020lm (coma pegada a los watts)", () => {
    expect(extraer("TORTUGA LED 12W, 1020lm")).toEqual({ potencia_w: 12, flujo_lm: 1020 })
  })

  it("PORTALÁMPARA CERÁMICO E27 CON ESCUADRA (tildes)", () => {
    expect(extraer("PORTALÁMPARA CERÁMICO E27 CON ESCUADRA")).toEqual({ zocalo: "e27" })
  })

  it("termomagnética: 100A es corriente, 10kA poder de corte, 4P polos → nada de potencia ni tensión", () => {
    expect(extraer("Int. Termomagnético NXB-125. 100A. Icn:10kA. Curva D. 4P")).toEqual({
      corriente_a: 100,
      polos: 4,
      poder_corte_ka: 10,
      curva: "d",
    })
  })

  it("AMOLADORA ANGULAR 2000W", () => {
    expect(extraer("AMOLADORA ANGULAR 2000W")).toEqual({ potencia_w: 2000 })
  })

  it("CONTACTOR con bobina de 24 VCA → tensión 24 (9A es corriente)", () => {
    expect(extraer("CONTACTOR 3P 9A 1NA Bob: 24VCA")).toEqual({ tension_v: 24, corriente_a: 9, polos: 3 })
  })

  it.each([
    ["INTERRUPTOR DIFERENCIAL 2 POLOS", 2],
    ["SECCIONADOR 4 POLOS", 4],
    ["INTERRUPTOR 1 POLO", 1],
    ["CONTACTOR 3POLOS", 3],
  ])("polos en letras: %s", (nombre, polos) => {
    expect(extraer(nombre as string).polos).toBe(polos)
  })

  it("polos en letras: no con neutro aparte ni fuera de 1 a 4", () => {
    expect(extraer("TERMICA 3 POLOS + N").polos).toBeUndefined()
    expect(extraer("BORNERA 12 POLOS").polos).toBeUndefined()
    expect(extraer("FICHA 6 POLOS").polos).toBeUndefined()
  })
})

describe("extraerAtributosDeNombre: bordes", () => {
  it("lee nombre + descripción (el nombre comercial suele estar en la descripción de Alegra)", () => {
    expect(extraer("CL-1234", "Lámpara bulbo LED 9W E27 luz día")).toEqual({ potencia_w: 9, zocalo: "e27", tono: "frio" })
  })

  it("kilowatts y decimales", () => {
    expect(extraer("CALEFACTOR 1,5KW")).toEqual({ potencia_w: 1500 })
    expect(extraer("LAMPARA 4.5W GU10")).toEqual({ potencia_w: 4.5, zocalo: "gu10" })
  })

  it("tono desde los kelvin cuando el nombre no lo dice", () => {
    expect(extraer("DICROICA 7W 6500K")).toEqual({ potencia_w: 7, temperatura_k: 6500, tono: "frio" })
    expect(extraer("TUBO 18W 4000 K")).toEqual({ potencia_w: 18, temperatura_k: 4000, tono: "neutro" })
  })

  it("dos tonos en el nombre es ambiguo: sin tono", () => {
    expect(extraer("LAMPARA 9W CALIDO/FRIO")).toEqual({ potencia_w: 9 })
  })

  it("ALTA CALIDAD no es luz cálida", () => {
    expect(extraer("CABLE ALTA CALIDAD")).toEqual({})
  })

  it("tensiones: 12V, 220 volts, rango sin 220 y doble tensión", () => {
    expect(extraer("FUENTE 12V 5A")).toEqual({ tension_v: 12, corriente_a: 5 })
    expect(extraer("MOTOR 220 VOLTS")).toEqual({ tension_v: 220 })
    expect(extraerAtributosDeNombre("DRIVER 12-24V").find((a) => a.clave === "tension_v")).toEqual({
      clave: "tension_v",
      valorNum: 24,
      valorTexto: "12-24",
    })
    expect(extraerAtributosDeNombre("DISYUNTOR 230/400V").find((a) => a.clave === "tension_v")).toEqual({
      clave: "tension_v",
      valorNum: 230,
      valorTexto: "230/400",
    })
  })

  it("IP65 y exterior; IPX4 no se guarda (no es un número)", () => {
    expect(extraer("REFLECTOR 100W IP65")).toEqual({ potencia_w: 100, ip: 65 })
    expect(extraer("APLIQUE IPX4")).toEqual({ montaje: "aplicar" })
  })

  it("lúmenes con separador de miles", () => {
    expect(extraer("PANEL 1.600 lm")).toEqual({ flujo_lm: 1600 })
  })

  it("2X36W (varios tubos) es ambiguo: no inventa potencia", () => {
    expect(extraer("EQUIPO 2X36W")).toEqual({})
  })

  it("vacío o sin nada técnico", () => {
    expect(extraerAtributosDeNombre("")).toEqual([])
    expect(extraerAtributosDeNombre("CINTA AISLADORA", null)).toEqual([])
  })

  it("sólo devuelve claves del catálogo cerrado, una por clave", () => {
    const a = extraerAtributosDeNombre("PANEL 12W 18W AC85-265V 3000K CALIDO IP65 E27 1020LM")
    for (const x of a) expect(CLAVES_ATRIBUTO).toContain(x.clave)
    expect(new Set(a.map((x) => x.clave)).size).toBe(a.length)
    expect(comoMapa(a).potencia_w).toBe(12)
  })
})

describe("tonoDeKelvin", () => {
  it("rangos", () => {
    expect(tonoDeKelvin(2700)).toBe("calido")
    expect(tonoDeKelvin(3000)).toBe("calido")
    expect(tonoDeKelvin(4000)).toBe("neutro")
    expect(tonoDeKelvin(6500)).toBe("frio")
    expect(tonoDeKelvin(Number.NaN)).toBeNull()
  })
})

describe("normalizarAtributos (lo que llega del PDF o del panel manual)", () => {
  it("descarta claves desconocidas, fuera de rango o sin valor; completa tono desde kelvin", () => {
    expect(
      comoMapa(
        normalizarAtributos({
          potencia_w: 50,
          temperatura_k: 3000,
          tono: null,
          ip: 65,
          flujo_lm: -3,
          tension_v: "220",
          zocalo: " E-27 ",
          material: "pvc",
        }),
      ),
    ).toEqual({ potencia_w: 50, temperatura_k: 3000, tono: "calido", ip: 65, tension_v: 220, zocalo: "e27" })
  })

  it("tono inválido se ignora; tono explícito le gana al de kelvin", () => {
    expect(comoMapa(normalizarAtributos({ tono: "turquesa" }))).toEqual({})
    expect(comoMapa(normalizarAtributos({ tono: "Neutra", temperatura_k: 3000 }))).toEqual({
      tono: "neutro",
      temperatura_k: 3000,
    })
  })

  it("tensión como rango de texto", () => {
    expect(normalizarAtributos({ tension_v: "100-240" })).toEqual([
      { clave: "tension_v", valorNum: 220, valorTexto: "100-240" },
    ])
  })

  it("no es objeto → nada", () => {
    expect(normalizarAtributos(null)).toEqual([])
    expect(normalizarAtributos("x")).toEqual([])
  })
})

describe("parsearEdicionManual", () => {
  it("valores a fijar y claves a quitar", () => {
    expect(parsearEdicionManual({ valores: { potencia_w: "45", tono: "Cálido", ip: null, zocalo: "" } })).toEqual({
      ok: true,
      valores: [
        { clave: "potencia_w", valorNum: 45, valorTexto: null },
        { clave: "tono", valorNum: null, valorTexto: "calido" },
      ],
      quitar: ["ip", "zocalo"],
    })
  })

  it("no completa el tono desde los kelvin (eso lo decide el operador)", () => {
    const r = parsearEdicionManual({ valores: { temperatura_k: 3000 } })
    expect(r).toEqual({ ok: true, valores: [{ clave: "temperatura_k", valorNum: 3000, valorTexto: null }], quitar: [] })
  })

  it("clave desconocida o valor inválido → error con el campo", () => {
    expect(parsearEdicionManual({ valores: { material: "pvc" } })).toMatchObject({ ok: false, campo: "material" })
    expect(parsearEdicionManual({ valores: { potencia_w: "mucha" } })).toMatchObject({ ok: false, campo: "potencia_w" })
    expect(parsearEdicionManual({ valores: { temperatura_k: 50 } })).toMatchObject({ ok: false, campo: "temperatura_k" })
    expect(parsearEdicionManual(null)).toMatchObject({ ok: false, campo: "valores" })
  })
})

describe("normalizarAtributos: claves ampliadas (0053)", () => {
  const n = (e: Record<string, unknown>) => comoMapa(normalizarAtributos(e))

  it("una muestra válida por clave nueva", () => {
    expect(
      n({
        corriente_a: 25, polos: 2, seccion_mm2: 2.5, medidas_mm: "300x1200", color: "Blanca", poder_corte_ka: 6,
        curva: "C", sensibilidad_ma: 30, largo_m: 100, montaje: "Embutir", angulo_grados: 60, leds_m: 120, potencia_w_m: 14.4, leds_rollo: 300, diametro_mm: 25, ancho_mm: 150, dimerizable: "Sí", modulos: 12,
      }),
    ).toEqual({
      corriente_a: 25, polos: 2, seccion_mm2: 2.5, medidas_mm: "300x1200", color: "blanco", poder_corte_ka: 6,
      curva: "c", sensibilidad_ma: 30, largo_m: 100, montaje: "embutir", angulo_grados: 60, leds_m: 120, potencia_w_m: 14.4, leds_rollo: 300, diametro_mm: 25, ancho_mm: 150, dimerizable: "si", modulos: 12,
    })
  })

  it.each([
    ["corriente_a", 0.05], ["corriente_a", 7000], ["polos", 6], ["polos", 0], ["polos", 2.5], ["seccion_mm2", 0.1],
    ["seccion_mm2", 2000], ["poder_corte_ka", 0.5], ["poder_corte_ka", 150], ["sensibilidad_ma", 2], ["sensibilidad_ma", 5000],
    ["largo_m", 0.01], ["largo_m", 5000], ["angulo_grados", 0], ["angulo_grados", 400], ["angulo_grados", 12.5],
    ["leds_m", 0], ["leds_m", 2000], ["leds_m", 60.5], ["potencia_w_m", 0.01], ["potencia_w_m", 5000],
    ["leds_rollo", 0], ["leds_rollo", 20000], ["leds_rollo", 300.5],
    ["diametro_mm", 4], ["diametro_mm", 250], ["ancho_mm", 20], ["ancho_mm", 1200], ["ancho_mm", 150.5],
    ["modulos", 0], ["modulos", 201], ["modulos", 12.5],
  ])("%s = %s fuera de rango (o no entero) se descarta", (clave, valor) => {
    expect(n({ [clave]: valor })).toEqual({})
  })

  it("límites del rango se aceptan", () => {
    expect(n({ corriente_a: 0.1, polos: 1, seccion_mm2: 1000, poder_corte_ka: 100, sensibilidad_ma: 5, largo_m: 1000, angulo_grados: 360, leds_m: 1000, potencia_w_m: 0.1 })).toEqual({
      corriente_a: 0.1, polos: 1, seccion_mm2: 1000, poder_corte_ka: 100, sensibilidad_ma: 5, largo_m: 1000, angulo_grados: 360, leds_m: 1000, potencia_w_m: 0.1,
    })
  })

  it("curva E, color fucsia y montaje inventado se descartan", () => {
    expect(n({ curva: "E" })).toEqual({})
    expect(n({ curva: "k" })).toEqual({})
    expect(n({ color: "fucsia" })).toEqual({})
    expect(n({ montaje: "volador" })).toEqual({})
  })

  it("medidas_mm: AxB[xC] válido, mal formado descartado", () => {
    expect(normalizarAtributos({ medidas_mm: "100x100x50" })).toEqual([{ clave: "medidas_mm", valorNum: null, valorTexto: "100x100x50" }])
    expect(n({ medidas_mm: "100 X 200 mm" })).toEqual({ medidas_mm: "100x200" })
    expect(n({ medidas_mm: "30 x 40 cm" })).toEqual({ medidas_mm: "300x400" })
    expect(n({ medidas_mm: "100x" })).toEqual({})
    expect(n({ medidas_mm: "abc" })).toEqual({})
    expect(n({ medidas_mm: "100" })).toEqual({})
    expect(n({ medidas_mm: "1x2x3x4" })).toEqual({})
    expect(n({ medidas_mm: "0x10" })).toEqual({})
  })

  it("color y montaje aceptan sinónimos del vocabulario", () => {
    expect(n({ color: "BCO" })).toEqual({ color: "blanco" })
    expect(n({ color: "negra" })).toEqual({ color: "negro" })
    expect(n({ montaje: "de aplicar" })).toEqual({ montaje: "aplicar" })
    expect(n({ montaje: "riel din" })).toEqual({ montaje: "din" })
    expect(n({ montaje: "embutido" })).toEqual({ montaje: "embutir" })
  })

  it("números como texto", () => {
    expect(n({ corriente_a: "16", seccion_mm2: "2,5" })).toEqual({ corriente_a: 16, seccion_mm2: 2.5 })
  })
})

describe("parsearEdicionManual: claves ampliadas", () => {
  it("polos = 2 es válido; curva E y color fuera de vocabulario son inválidos", () => {
    expect(parsearEdicionManual({ valores: { polos: "2" } })).toEqual({
      ok: true,
      valores: [{ clave: "polos", valorNum: 2, valorTexto: null }],
      quitar: [],
    })
    expect(parsearEdicionManual({ valores: { curva: "E" } })).toMatchObject({ ok: false, campo: "curva" })
    expect(parsearEdicionManual({ valores: { color: "fucsia" } })).toMatchObject({ ok: false, campo: "color" })
    expect(parsearEdicionManual({ valores: { montaje: "volador" } })).toMatchObject({ ok: false, campo: "montaje" })
    expect(parsearEdicionManual({ valores: { polos: "6" } })).toMatchObject({ ok: false, campo: "polos" })
  })

  it("medidas AxB[xC]", () => {
    expect(parsearEdicionManual({ valores: { medidas_mm: "100x100x50" } })).toMatchObject({ ok: true })
    expect(parsearEdicionManual({ valores: { medidas_mm: "100x" } })).toMatchObject({ ok: false, campo: "medidas_mm" })
  })

  it("el mensaje de error es en usted y nombra el campo", () => {
    const r = parsearEdicionManual({ valores: { curva: "E" } })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Curva") })
  })
})

/** Tabla de casos de extracción desde el nombre (ejemplos ficticios): [nombre, esperado (solo claves nuevas)]. */
const NUEVAS = ["corriente_a", "polos", "seccion_mm2", "medidas_mm", "color", "poder_corte_ka", "curva", "sensibilidad_ma", "largo_m", "montaje", "angulo_grados", "leds_m", "potencia_w_m", "leds_rollo"]
function nuevas(nombre: string): Record<string, number | string> {
  return Object.fromEntries(Object.entries(extraer(nombre)).filter(([k]) => NUEVAS.includes(k)))
}

/** Sólo diámetro y ancho: lo que lean las otras claves del mismo nombre se prueba en sus propios casos. */
/** Sólo una clave del extractor (dimerizable, módulos): lo que lean las otras del mismo nombre se prueba en sus propios casos. */
function soloClave(nombre: string, descripcion: string | undefined, clave: string): Record<string, number | string> {
  return Object.fromEntries(Object.entries(extraer(nombre, descripcion)).filter(([k]) => k === clave))
}

function diaAncho(nombre: string): Record<string, number | string> {
  return Object.fromEntries(Object.entries(extraer(nombre)).filter(([k]) => k === "diametro_mm" || k === "ancho_mm"))
}

describe("extracción de claves nuevas desde el nombre", () => {
  describe("seccion_mm2", () => {
    it.each([
      ["CABLE 2,5MM2", { seccion_mm2: 2.5 }],
      ["CABLE 3X1.5MM2", { seccion_mm2: 1.5 }],
      ["CABLE 4 MM²", { seccion_mm2: 4 }],
      ["CABLE 3X1.5MM2 ROLLO 100M", { seccion_mm2: 1.5, largo_m: 100 }],
      ["CANO 20MM", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  // La sección sin "mm2" solo se lee en un CABLE (por el nombre) y dentro de la serie comercial.
  describe("seccion_mm2 de un cable sin mm2 en el nombre", () => {
    it.each([
      ["CABLE 2,5MM", { seccion_mm2: 2.5 }],
      ["CABLE 2,5 MM", { seccion_mm2: 2.5 }],
      ["CABLE 2.5 MM2", { seccion_mm2: 2.5 }],
      ["CABLE 2,5MM²", { seccion_mm2: 2.5 }],
      ["CABLE 4MM", { seccion_mm2: 4 }],
      ["CABLE 4MM2", { seccion_mm2: 4 }],
      ["CABLE 3X2,5", { seccion_mm2: 2.5 }],
      ["CABLE 3X2,5MM", { seccion_mm2: 2.5 }],
      ["CABLE 2X1.5", { seccion_mm2: 1.5 }],
      ["CABLE 3X1.5", { seccion_mm2: 1.5 }],
      ["CABLE 2 X 1,5", { seccion_mm2: 1.5 }],
      ["CABLE TIPO TALLER 2X0.75 ROLLO 100M", { seccion_mm2: 0.75, largo_m: 100 }],
      ["CABLE SUBTERRANEO 4X6", { seccion_mm2: 6 }],
      ["CABLE SUBTERRÁNEO 3X10MM", { seccion_mm2: 10 }],
      ["CABLE UNIPOLAR 2.5", { polos: 1, seccion_mm2: 2.5 }],
      ["CABLE UNIPOLAR 2.5MM", { polos: 1, seccion_mm2: 2.5 }],
      ["UNIPOLAR 1,5 MM VERDE/AMARILLO", { polos: 1, seccion_mm2: 1.5 }],
      ["BIPOLAR 1MM", { polos: 2, seccion_mm2: 1 }],
      ["CONDUCTOR 16MM", { seccion_mm2: 16 }],
      ["CORDON 2X1", { seccion_mm2: 1 }],
      ["CABLE 2,5MM ROLLO 100M", { seccion_mm2: 2.5, largo_m: 100 }],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))

    it("con mm2 explícito vale lo de siempre (no se pisa con la lectura del cable)", () => {
      expect(nuevas("CABLE 3X1.5MM2")).toEqual({ seccion_mm2: 1.5 })
      expect(nuevas("CABLE 4 MM²")).toEqual({ seccion_mm2: 4 })
    })

    it.each([
      // No es un cable: nunca hay sección.
      ["CANO 20MM"],
      ["CAÑO CORRUGADO 20MM"],
      ["TORNILLO 4MM"],
      ["TORNILLO PARKER 4X40"],
      ["LAMPARA TUBO LED 120CM 18W"],
      ["BROCA 6MM"],
      ["PANEL LED 60X60"],
      // Accesorios de cable: la medida es del accesorio.
      ["PRENSACABLE 20MM"],
      ["GRAMPA PARA CABLE 6MM"],
      ["ABRAZADERA PARA CABLE 10MM"],
      ["CABLE CANAL 20X10"],
      ["CABLECANAL 40X25"],
      ["TERMINAL PARA CABLE 4MM"],
      ["BANDEJA PORTACABLE 100X50"],
      // Cable pero no de cobre: el mm es un diámetro.
      ["CABLE DE ACERO 4MM"],
      ["CABLE GALVANIZADO 5MM"],
      // Telecom: no hay sección.
      ["CABLE UTP CAT 6 4X2X0.5"],
      ["CABLE COAXIL RG6 7MM"],
      // Fuera de la serie comercial o de los conductores plausibles.
      ["CABLE 3MM"],
      ["CABLE 7X9"],
      ["CABLE 12X2,5"],
      // Cantidades o largos que no son sección.
      ["CABLE 10 METROS"],
      ["CABLE UNIPOLAR 100 MTS"],
      ["CABLE 25 PARES"],
      // Dos secciones distintas: ante la duda, nada.
      ["CABLE 3X2,5 + 1X1,5"],
      ["CABLE 2,5MM / 4MM"],
    ])("sin sección: %s", (nombre) => {
      expect(extraer(nombre as string).seccion_mm2).toBeUndefined()
    })
  })

  describe("medidas_mm", () => {
    it.each([
      ["CAJA 100X100X50", { medidas_mm: "100x100x50" }],
      ["GABINETE 300X400 MM", { medidas_mm: "300x400" }],
      ["PANEL 600X600", { medidas_mm: "600x600" }],
      ["GABINETE 300X400X200 MM", { medidas_mm: "300x400x200" }],
      ["GABINETE 30X40 CM", { medidas_mm: "300x400" }],
      ["TUBO 2X36W", {}],
      ["LAMPARA 4X10W", {}],
      ["CABLE 3X1.5", { seccion_mm2: 1.5 }],
      ["PANEL 60X60", {}],
      ["CABLE 4X2,5 MM", { seccion_mm2: 2.5 }],
      ["CABLE 100X100X50MTS", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  describe("poder_corte_ka y sensibilidad_ma", () => {
    it.each([
      ["TERMICA 2X25A 6KA", { polos: 2, corriente_a: 25, poder_corte_ka: 6 }],
      ["LLAVE 10kA", { poder_corte_ka: 10 }],
      ["DIFERENCIAL 2X25A 30MA", { polos: 2, corriente_a: 25, sensibilidad_ma: 30 }],
      ["DIFERENCIAL 300 mA", { sensibilidad_ma: 300 }],
      ["DIFERENCIAL 2P 40A 30MA", { polos: 2, corriente_a: 40, sensibilidad_ma: 30 }],
      ["SENSOR 4-20MA", {}],
      ["DIFERENCIAL 30MAH", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))

    it("10kA no genera tensión, temperatura ni corriente", () => {
      expect(extraer("LLAVE 10kA")).toEqual({ poder_corte_ka: 10 })
    })
  })

  describe("curva", () => {
    it.each([
      ["TERMICA CURVA C 16A", { curva: "c", corriente_a: 16 }],
      ["DISYUNTOR C16", { curva: "c", corriente_a: 16 }],
      ["LLAVE D32", { curva: "d", corriente_a: 32 }],
      ["TERMICA C16 2P", { curva: "c", corriente_a: 16, polos: 2 }],
      ["TERMICA CURVA K", {}],
      ["CABLE C 2X1", { seccion_mm2: 1 }],
      ["PERFIL D 20", {}],
      ["LAMPARA B22 9W", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  describe("polos", () => {
    it.each([
      ["LLAVE 3P 40A", { polos: 3, corriente_a: 40 }],
      ["TERMICA BIPOLAR 20A", { polos: 2, corriente_a: 20 }],
      ["INTERRUPTOR TETRAPOLAR", { polos: 4 }],
      ["UNIPOLAR 10A", { polos: 1, corriente_a: 10 }],
      ["TERMICA 2X25A", { polos: 2, corriente_a: 25 }],
      ["MOTOR TRIFASICO", {}],
      ["TUBO LED 2X36W", {}],
      ["LAMPARA 4X10W", {}],
      ["CABLE UTP CAT 6A 4P", {}],
      ["PATCH CORD RJ45 2P 3A", {}],
      ["TERMICA 2X25A 3P", { corriente_a: 25 }],
      ["TERMICA 1P+N 16A", { corriente_a: 16 }],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  describe("corriente_a", () => {
    it.each([
      ["LLAVE 1P 32A", { polos: 1, corriente_a: 32 }],
      ["FUENTE 12V 5A", { corriente_a: 5 }],
      ["REGULADOR DE 1 A 10V", {}],
      ["FUENTE AC85-265V", {}],
      ["BATERIA 7AH", {}],
      ["LAMPARA A60 9W", {}],
      ["LAMPARA A19 9W", {}],
      ["FUENTE 5A Y 10A", {}],
      // Con contexto de relé térmico el rango sí se lee (ver "rango de regulación"); sin contexto, no.
      ["TERMINAL 13-18A", {}],
      ["TRAFO DE CORRIENTE 1200/5A", {}],
      ["CONTACTOR NCH8-63M/20 63A", { corriente_a: 63 }],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))

    it("30mA nunca es corriente_a", () => {
      expect(nuevas("DIFERENCIAL 30mA")).toEqual({ sensibilidad_ma: 30 })
      expect(nuevas("SENSOR 30mA")).toEqual({})
    })
  })

  describe("largo_m", () => {
    it.each([
      ["CABLE ROLLO 100M", { largo_m: 100 }],
      ["TIRA LED 5MTS", { largo_m: 5 }],
      ["CINTA 20 M", { largo_m: 20 }],
      ["MANGUERA 1,2 m", { largo_m: 1.2 }],
      ["CANO 20MM", {}],
      ["CAJA 100MM", {}],
      ["CINTA 100MM", {}],
      ["TERMICA 25A M", { corriente_a: 25 }],
      ["TIRA 14W/M", { potencia_w_m: 14 }],
      ["CONTACTOR NCH8-25M/20", {}],
      ["PORTALAMPARA GUIR-10MT-E27", {}],
      ["TIRA NEON LARGO 5M", { largo_m: 5 }],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  describe("leds_m y potencia_w_m (por metro)", () => {
    it.each([
      ["TIRA LED 60 LED/m", { leds_m: 60 }],
      ["TIRA LED 60 LEDs/m", { leds_m: 60 }],
      ["TIRA 2835 120LED/M", { leds_m: 120 }],
      ["TIRA 60 LEDS POR METRO", { leds_m: 60 }],
      ["TIRA 14.4W/m", { potencia_w_m: 14.4 }],
      ["TIRA 4,8 W/M", { potencia_w_m: 4.8 }],
      ["TIRA 60 LED/m 14.4W/m 5M", { leds_m: 60, potencia_w_m: 14.4, largo_m: 5 }],
      ["TIRA 60 LED/m 120 LED/m", {}],
      ["TIRA 60 LED 5M", { largo_m: 5 }],
      ["PANEL 100 W/m²", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))

    it("la potencia por metro no es potencia_w", () => {
      expect(extraer("TIRA LED 14.4W/m")).toEqual({ potencia_w_m: 14.4 })
      expect(extraer("TIRA LED 24W 14.4W/m")).toEqual({ potencia_w: 24, potencia_w_m: 14.4 })
    })
  })

  describe("leds_rollo (total del rollo)", () => {
    it.each([
      ["TIRA LED 300 LED POR ROLLO", { leds_rollo: 300 }],
      ["TIRA 600 LED X ROLLO 5M", { leds_rollo: 600, largo_m: 5 }],
      ["TIRA 300 LED TOTALES", { leds_rollo: 300 }],
      ["TIRA 300 LED TOTAL", { leds_rollo: 300 }],
      ["TIRA 300 LED ROLLO", {}],
      ["TIRA 300 LED 5M", { largo_m: 5 }],
      ["TIRA 60 LED/m 5M", { leds_m: 60, largo_m: 5 }],
      ["TIRA 60 LEDs por metro por rollo", { leds_m: 60 }],
      ["TIRA 300 LED", {}],
      ["TIRA 300 LED 600 LED TOTAL", {}],
      ["ROLLO 5M", { largo_m: 5 }],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  describe("diametro_mm (caños, tubos y accesorios de caño)", () => {
    it.each([
      ["TUBO RIGIDO MARCA X 20MM X METRO", { diametro_mm: 20 }],
      ["Tubo rígido Marca X SD ø25mm x metro", { diametro_mm: 25 }],
      ["Caño semipesado D:50mm x 3 Mtrs (1.2mm", { diametro_mm: 50 }],
      ["CAÑO CORRUGADO 32 MM", { diametro_mm: 32 }],
      ["Conector para tubo rígido y corrugado 32mm", { diametro_mm: 32 }],
      ["Curva para tubo rígido 25mm", { diametro_mm: 25 }],
      ["Unión para tubo Marca X 20mm", { diametro_mm: 20 }],
      ["Grampa p/fijar tubo rígido 22mm", { diametro_mm: 22 }],
      ["Cupla para caño Ø 40 mm", { diametro_mm: 40 }],
      ["CABLECANAL REDONDO 16MM", { diametro_mm: 16 }],
      ["CAÑO PVC 12,5MM", { diametro_mm: 12.5 }],
      ["Caño Ø20mm ESP 1,5mm", { diametro_mm: 20 }],
      // Una cupla o un conector SIN palabra de caño/tubo solo valen con el diámetro explícito.
      ["Conector 25mm", {}],
      ["Conector ø25mm", { diametro_mm: 25 }],
      // Negativos: otras magnitudes con "mm", espesores, tubos de luz, herramientas, conductores.
      ["Conector de empalme de 2 conductores de hasta 4mm²", {}],
      ["Conector de empalme de 2 conductores de hasta 4mm2", {}],
      ["Conector para tubo de 2 conductores 4mm", {}],
      ["CABLE 3X2,5MM", {}],
      ["CABLE UNIPOLAR 2,5MM2", {}],
      ["TUBO LED T8 18W 120CM", {}],
      ["TUBO VIDRIO 18W AC185-265V 120CM CALIDO 3000K", {}],
      ["ESTANCO TUBO 2 TUBOS LED 18W 25MM", {}],
      ["LLAVE DE TUBO EN T 12MM", {}],
      ["KIT DE TUBOS HEXAGONALES 10MM", {}],
      ["ABRAZADERA DE MANGUERA 20MM", {}],
      ["TORNILLO 4MM X 40MM", {}],
      ["TUBO CUADRADO 20X20MM", {}],
      ["TUBO PERFIL 20 x 10mm", {}],
      ["TUBO 3/4 PULGADAS", {}],
      ["TUBO 2 MM", {}],
      ["TUBO 300 MM", {}],
      ["LAMPARA 120CM", {}],
      ["CAÑO DOS DIAMETROS 20MM Y 25MM", {}],
      ["Colgante globo caño 10x1 Ø 60 cm, 3 luces", {}],
      ["TIJERA PARA CAÑO DE PVC HASTA 42mm", {}],
      ["ALARGADOR DE 125MM PARA TUBOS DE 1/2\"", {}],
    ])("%s", (nombre, esperado) => expect(diaAncho(nombre as string)).toEqual(esperado))

    it("la descripción no aporta diámetro (solo el nombre)", () => {
      expect(extraer("TUBO RIGIDO", "Caño de 25mm de diámetro")).toEqual({})
    })
  })

  describe("ancho_mm (bandejas portacables)", () => {
    it.each([
      ["BANDEJA PERFORADA 100/50", { ancho_mm: 100 }],
      ["BANDEJA PORTACABLE PERFORADA 300/50 3M", { ancho_mm: 300 }],
      ["CURVA ARTICULADA 250/50", { ancho_mm: 250 }],
      ["ARTICULADA 250/50", { ancho_mm: 250 }],
      ["TAPA BANDEJA 150", { ancho_mm: 150 }],
      ["TAPA BANDEJA PORTACABLE 450 MM", { ancho_mm: 450 }],
      ["TEE BANDEJA 200/50", { ancho_mm: 200 }],
      ["UNION BANDEJA PERFORADA 150/50", { ancho_mm: 150 }],
      ["BANDEJA PERFORADA 100 / 50", { ancho_mm: 100 }],
      // Negativos: relaciones, otras bandejas, sin palabra de bandeja, valores de otra magnitud.
      ["TRANSFORMADOR DE CORRIENTE 1200/5A", {}],
      ["TRANSFORMADOR DE CORRIENTE 100/5", {}],
      ["TERMICA 2P 100/50", {}],
      ["BANDEJA MAGNETICA RECTANGULAR", {}],
      ["BANDEJA MAGNETICA 150", {}],
      ["BANDEJA PARA PINTURA 250", {}],
      ["BANDEJA PERFORADA 100/50 y 200/50", {}],
      ["BANDEJA PERFORADA 3M", {}],
      ["BANDEJA PERFORADA 20W 150", {}],
      ["BANDEJA PERFORADA 2000/50", {}],
      ["LAMPARA ARTICULADA 12W", {}],
      ["BRAZO ARTICULADO 100", {}],
      ["CABLE 1200/5A", {}],
      // Bandejas de rack de 19": "P." es la profundidad, no un ancho de bandeja portacables.
      ["Bandeja fija ciega 19\" regulable P. 600/800 mm", {}],
      ["Bandeja fija ventilada 19\" x 1U P. 300 mm", {}],
    ])("%s", (nombre, esperado) => expect(diaAncho(nombre as string)).toEqual(esperado))
  })

  describe("dimerizable (lámparas, paneles, tiras y drivers)", () => {
    it.each([
      ["LAMPARA LED E27 9W DIMERIZABLE", { dimerizable: "si" }],
      ["Lámpara filamento 8W E27 dimeable", { dimerizable: "si" }],
      ["LAMPARA AR111 15W DIMMABLE", { dimerizable: "si" }],
      ["LAMPARA AR111 15W DIMMERIZABLE", { dimerizable: "si" }],
      ["DICROICA GU10 5W TRIAC DIM AC180-260V", { dimerizable: "si" }],
      ["FUENTE LED SLIM DIMERIZABLE 12V 60W", { dimerizable: "si" }],
      ["DRIVER DIMERIZABLE PARA PANEL 24W", { dimerizable: "si" }],
      ["LAMPARA LED VELADOR 5W NO DIMERIZABLE", { dimerizable: "no" }],
      ["PANEL LED 18W no dimeable", { dimerizable: "no" }],
      ["PANEL LED 18W (NO ES DIMERIZABLE)", { dimerizable: "no" }],
      // La sigla "DIM" / "NO DIM" de los nombres de lámparas.
      ["AR111 15W GU10 AC200-240V CALIDO 2700K DIM 30º", { dimerizable: "si" }],
      ["BULBO G125 FILAMENTO 8W E27 AC180-265V FRIO 6000K DIM", { dimerizable: "si" }],
      ["DICRO ECO DIM 7W AC100-240V CALIDO 2700K", { dimerizable: "si" }],
      ["MR16-8W-12-DIM WW", { dimerizable: "si" }],
      ["AR111 11W GU10 COB NO DIM AC100-240V FP>0.9 NEUTRO 4000K", { dimerizable: "no" }],
      ["DICROICA VIDRIO GU10 7W NO DIM AC180-265V CALIDO", { dimerizable: "no" }],
      // "DIM" como dimensión o en un producto sin señal de lámpara no se lee.
      ["GABINETE DIM 300 X 400 X 150", {}],
      ["PANEL 18W DIM 300X300", {}],
      ["CAJA DE PASO DIM", {}],
      // Sin el dato, nada: una lámpara que no lo dice no es "no dimerizable".
      ["LAMPARA LED E27 9W CALIDA", {}],
      // El producto regula a otro: un dimmer, una tecla o un variador no son "dimerizables".
      ["DIMMER LED BLANCO", {}],
      ["TECLA Y DIMMER LED BLANCO", {}],
      ["TECLA DIMERIZABLE SMART 1.5A MAX BLANCA", {}],
      ["VARIADOR DE LUMINOSIDAD DIMERIZABLE", {}],
      ["SENSOR TACTIL PARA ENCENDIDO Y DIMERIZADO DE TIRAS LED", {}],
      // Es dato de otro producto ("para lámparas dimerizables", "compatible con").
      ["TRANSFORMADOR PARA LAMPARAS DIMERIZABLES", {}],
      ["CONTROLADOR COMPATIBLE CON TIRAS DIMERIZABLE", {}],
      // Contradicción: ambos sentidos en el mismo producto = ninguno.
      ["LAMPARA 9W DIMERIZABLE / NO DIMERIZABLE", {}],
    ])("%s", (nombre, esperado) => expect(soloClave(nombre as string, undefined, "dimerizable")).toEqual(esperado))

    it("lee la descripción de Alegra, pero un dimmer sigue siendo un dimmer", () => {
      expect(soloClave("LAMPARA LED VELADOR NEGRO 18W", "AC100-240V, RA>90, DIMEABLE, MEMORIA ULTIMA FUNCION", "dimerizable")).toEqual({ dimerizable: "si" })
      expect(soloClave("Llave modular blanca", "DIMMER LED", "dimerizable")).toEqual({})
      expect(soloClave("GALPONERA 150W", "FRIO 5700K, IP65, DIMERIZABLE 0-10V", "dimerizable")).toEqual({ dimerizable: "si" })
    })

    it("normalizarAtributos acepta sí/no/booleano y descarta el resto", () => {
      const n = (v: unknown) => comoMapa(normalizarAtributos({ dimerizable: v }))
      expect(n("Sí")).toEqual({ dimerizable: "si" })
      expect(n("NO")).toEqual({ dimerizable: "no" })
      expect(n(true)).toEqual({ dimerizable: "si" })
      expect(n(false)).toEqual({ dimerizable: "no" })
      expect(n("tal vez")).toEqual({})
      expect(n(1)).toEqual({})
    })
  })

  describe("modulos (módulos DIN de gabinetes, cajas y tableros)", () => {
    it.each([
      ["Caja de embutir p/ 12 mód. DIN pta fume", { modulos: 12 }],
      ["Caja emb. 4 mod. DIN c/ tapa", { modulos: 4 }],
      ["Cajas p/ Pilastra 8 Mod. DIN IP65 Blanca", { modulos: 8 }],
      ["Caja p/Pilar para 9 Mod DIN (IP 65) con tapa transparente", { modulos: 9 }],
      ["Gabinete modular P/96 Mod DIN 550x637x180mm", { modulos: 96 }],
      ["Gab. P/24 Módulos DIN 330x315x180mm", { modulos: 24 }],
      ["Caja IP65 p/12 polos DIN", { modulos: 12 }],
      ["Caja embutir 36 polos frente y puerta blanca", { modulos: 36 }],
      ["Gab. estanco 420x420X210 96 P. cierre media vuelta", { modulos: 96 }],
      ["Caja ext. TM 4 bocas c/tapa fumé", { modulos: 4 }],
      ["Caja IP 65 190x285x185 p/10 Bocas Puerta Opaca", { modulos: 10 }],
      ["Gabinete para térmicas IP65 12 módulos 15 x 27 x 10,1 cm", { modulos: 12 }],
      ["Tablero 18 bocas", { modulos: 18 }],
      // Los módulos que acompañan a los polos no son la capacidad: gana lo explícito de polos/DIN.
      ["Caja IP65 p/12 polos DIN + dos módulos ciegos", { modulos: 12 }],
      ["Caja IP65 p/12 polos DIN + 2 módulos p/tomas", { modulos: 12 }],
      // Módulos de bastidor de una caja de mecanismos (teclas y tomas): otra unidad, no se leen.
      ["Caja de superficie vacía 2 módulos negro", {}],
      ["Caja armada 2 interruptores 10 Ax (2 módulos) negro", {}],
      ["Caja exterior 3 módulos armada c/ 1 interruptor", {}],
      // Accesorios y otras familias que dicen "polos" o "módulos".
      ["Contrafrente abisagrado calado p/12 Polos", {}],
      ["Contraf. Abisagrado Calado 20 Mod DIN. p/ gabinete", {}],
      ["Tapa DIN para 4 polos blanca", {}],
      ["Caballete regulable 9 polos", {}],
      ["Riel DIN 35 mm. Longitud 1 metro", {}],
      ["Modulo p/19 polos DIN 19” x 3U", {}],
      ["Interruptor 2 polos 25A", {}],
      ["Bornera 4 polos termorigida", {}],
      ["Interruptor caja moldeada 4 polos 50A", {}],
      ["Interruptor 2 mod blanco", {}],
      // Dos capacidades distintas = ninguna.
      ["Caja p/12 polos DIN o 24 polos DIN", {}],
      // Fuera de rango.
      ["Gabinete p/288 Mod DIN", {}],
    ])("%s", (nombre, esperado) => expect(soloClave(nombre as string, undefined, "modulos")).toEqual(esperado))

    it("la capacidad puede venir en la descripción de Alegra", () => {
      expect(soloClave("Gab. estanco 200x200x100", "CF calado p/6 Mod DIN.", "modulos")).toEqual({ modulos: 6 })
      expect(soloClave("Caja sobreponer 4P marco blanco", "Caja sobreponer 4 polos marco blanco", "modulos")).toEqual({ modulos: 4 })
      // Pero el producto tiene que SER la envolvente: la descripción de un accesorio no cuenta.
      expect(soloClave("Soporte de riel", "para gabinete de 12 Mod DIN", "modulos")).toEqual({})
    })

    it("normalizarAtributos: entero de 1 a 200", () => {
      const n = (v: unknown) => comoMapa(normalizarAtributos({ modulos: v }))
      expect(n(12)).toEqual({ modulos: 12 })
      expect(n("36")).toEqual({ modulos: 36 })
      expect(n(1)).toEqual({ modulos: 1 })
      expect(n(200)).toEqual({ modulos: 200 })
      expect(n(0)).toEqual({})
      expect(n(201)).toEqual({})
      expect(n(12.5)).toEqual({})
    })
  })

  describe("angulo_grados", () => {
    it.each([
      ["DICROICA 60°", { angulo_grados: 60 }],
      ["SPOT 38 GRADOS", { angulo_grados: 38 }],
      ["SPOT 36° BLANCO", { angulo_grados: 36, color: "blanco" }],
      ["LAMPARA 3000K 12V", {}],
      ["SENSOR 40°C", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  describe("color", () => {
    it.each([
      ["CANALETA BLANCO", { color: "blanco" }],
      ["CINTA NEGRA", { color: "negro" }],
      ["TIRA BCO", { color: "blanco" }],
      ["PLAFON DE EMBUTIR NEGRO", { montaje: "embutir", color: "negro" }],
      ["LAMPARA LUZ BLANCA", {}],
      ["TIRA BLANCO FRIO", {}],
      ["TIRA BLANCO CALIDO", {}],
      ["CABLE ROJO Y NEGRO", {}],
      ["CABLE VERDE/AMARILLO", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))

    it("las frases de tono siguen dando tono (no cambia el comportamiento previo)", () => {
      expect(extraer("TIRA BLANCO FRIO")).toEqual({ tono: "frio" })
    })
  })

  describe("montaje", () => {
    it.each([
      ["CAJA EMBUTIR", { montaje: "embutir" }],
      ["PLAFON APLICAR", { montaje: "aplicar" }],
      ["LAMPARA COLGANTE", { montaje: "colgante" }],
      ["TERMICA 2X25A PARA RIEL DIN", { polos: 2, corriente_a: 25, montaje: "din" }],
      ["PROYECTOR PARA RIEL", { montaje: "riel" }],
      ["SPOT TRACK", { montaje: "riel" }],
      ["CAJA EMBUTIR/APLICAR", {}],
      // La familia "aplique" ya dice el montaje (ver "familias del nombre").
      ["APLIQUE LED", { montaje: "aplicar" }],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
  })

  it("ACCESORIO VARIOS no genera ninguna clave nueva", () => {
    expect(nuevas("ACCESORIO VARIOS")).toEqual({})
  })

  it("las 7 claves existentes no cambian por la presencia de las nuevas", () => {
    expect(extraer("PANEL 600X600 40W 4000K IP20 AC85-265V")).toMatchObject({
      potencia_w: 40, temperatura_k: 4000, tono: "neutro", ip: 20, tension_v: 220, medidas_mm: "600x600",
    })
  })

  it("devuelve las claves nuevas en el orden del registro", () => {
    const orden = extraerAtributosDeNombre("TERMICA C16 2P 6KA RIEL DIN").map((a) => a.clave)
    expect(orden).toEqual([...orden].sort((a, b) => CLAVES_ATRIBUTO.indexOf(a) - CLAVES_ATRIBUTO.indexOf(b)))
  })
})

describe("eficiencia y magnitudes por metro no son flujo, potencia ni corriente", () => {
  it("REFLECTOR 50W 110lm/W: la eficiencia no es flujo", () => {
    expect(extraer("REFLECTOR 50W 110lm/W")).toEqual({ potencia_w: 50 })
  })

  it("PANEL 18W 1600LM 90 LM/W: el flujo es 1600", () => {
    expect(extraer("PANEL 18W 1600LM 90 LM/W")).toEqual({ potencia_w: 18, flujo_lm: 1600 })
  })

  it.each(["110 lm/W", "130LM/W", "110lm/w", "110 lm / W", "110 lm/Watt", "110 lm por W", "110 lumenes por watt", "110 lúmenes por watt"])(
    "variante de eficiencia %s: sin flujo",
    (e) => {
      expect(extraer(`REFLECTOR 50W ${e}`)).toEqual({ potencia_w: 50 })
    },
  )

  it("eficiencia sin número (Lm/Watt) no rompe el resto", () => {
    expect(extraer("PANEL 18W 1600LM Lm/Watt")).toEqual({ potencia_w: 18, flujo_lm: 1600 })
  })

  it("TIRA 14,4W/m 1200lm/m: por metro, ni flujo ni potencia", () => {
    expect(extraer("TIRA 14,4W/m 1200lm/m")).toEqual({ potencia_w_m: 14.4 })
  })

  it("corriente por metro (A/m) y por m² (W/m²) no se extraen", () => {
    expect(extraer("CABLE 5A/m")).toEqual({})
    expect(extraer("PANEL 100 W/m² SOLAR")).toEqual({})
    expect(extraer("TIRA 12W/mt 3000K")).toEqual({ temperatura_k: 3000, tono: "calido", potencia_w_m: 12 })
  })

  it("no rompe lo que no es una relación", () => {
    expect(extraer("TERMOMAGNETICA 10A/30mA 2P")).toMatchObject({ polos: 2 })
    expect(extraer("TRAFO 230/400V 25M")).toMatchObject({ tension_v: 230, largo_m: 25 })
  })
})

describe("tono = tipo de luz (luces de color y RGB)", () => {
  it("'LUZ VERDE' y similares son tono, no color del producto", () => {
    expect(extraer("TIRA LED 5M LUZ VERDE")).toEqual({ tono: "verde", largo_m: 5 })
    expect(extraer("LAMPARA 9W E27 LUZ ROJA")).toEqual({ potencia_w: 9, zocalo: "e27", tono: "rojo" })
    expect(extraer("FOCO 7W LUZ AMARILLA")).toEqual({ potencia_w: 7, tono: "amarillo" })
    expect(extraer("FOCO 7W LUZ AZUL")).toEqual({ potencia_w: 7, tono: "azul" })
    expect(extraer("FOCO 7W LUZ NARANJA")).toEqual({ potencia_w: 7, tono: "naranja" })
    expect(extraer("FOCO 7W LUZ AMBAR")).toEqual({ potencia_w: 7, tono: "ambar" })
    expect(extraer("FOCO 7W LUZ ÁMBAR")).toEqual({ potencia_w: 7, tono: "ambar" })
    expect(extraer("FOCO 7W LUZ VIOLETA")).toEqual({ potencia_w: 7, tono: "violeta" })
    expect(extraer("FOCO 7W LUZ ROSA")).toEqual({ potencia_w: 7, tono: "rosa" })
  })

  it("RGB y RGBW son tonos distintos", () => {
    expect(extraer("TIRA LED 5050 RGB IP20")).toEqual({ tono: "rgb", ip: 20 })
    expect(extraer("TIRA LED 5050 RGBW")).toEqual({ tono: "rgbw" })
    expect(extraer("TIRA LED RGB/RGBW")).toEqual({})
  })

  it("conservador: un color suelto no es tipo de luz", () => {
    expect(extraer("CABLE UNIPOLAR 2,5MM2 VERDE")).toEqual({ polos: 1, seccion_mm2: 2.5, color: "verde" })
    expect(extraer("CINTA AISLADORA ROJA")).toEqual({ color: "rojo" })
  })

  it("dos tipos de luz distintos es ambiguo", () => {
    expect(extraer("FOCO LUZ VERDE CALIDO")).toEqual({})
  })

  it("el valor externo acepta sinónimos con y sin género", () => {
    for (const [entrada, esperado] of [
      ["Roja", "rojo"], ["amarilla", "amarillo"], ["Luz verde", "verde"], ["Violeta", "violeta"], ["Ámbar", "ambar"], ["ambar", "ambar"], ["RGB", "rgb"], ["RGBW", "rgbw"],
    ] as const) {
      expect(comoMapa(normalizarAtributos({ tono: entrada }))).toEqual({ tono: esperado })
    }
    expect(comoMapa(normalizarAtributos({ tono: "RGBY" }))).toEqual({})
  })

  it("el panel manual guarda 'rgbw' y define etiquetas nuevas", () => {
    expect(parsearEdicionManual({ valores: { tono: "rgbw" } })).toEqual({
      ok: true,
      valores: [{ clave: "tono", valorNum: null, valorTexto: "rgbw" }],
      quitar: [],
    })
    expect(DEFINICION_ATRIBUTOS.tono.etiqueta).toBe("Tipo de luz")
    expect(DEFINICION_ATRIBUTOS.color.etiqueta).toBe("Color del producto")
    expect(TONOS).toEqual(["calido", "neutro", "frio", "rojo", "verde", "azul", "amarillo", "naranja", "ambar", "violeta", "rosa", "rgb", "rgbw"])
  })
})

describe("magnitudes de la descripción que no son del producto (se decide por el nombre)", () => {
  const RANGOS = "Rangos: 200mV/2V/20V/200V/600V CC y CA, corriente 200uA/2mA/20mA/200mA/10A, 2 V"

  it("MULTÍMETRO DIGITAL: los rangos de medición no son tensión ni corriente", () => {
    const a = extraer("MULTÍMETRO DIGITAL, TRUE RMS 2000 CUENTAS", RANGOS)
    expect(a.tension_v).toBeUndefined()
    expect(a.corriente_a).toBeUndefined()
  })

  it("PINZA AMPERIMÉTRICA DIGITAL DE CA", () => {
    const a = extraer("PINZA AMPERIMÉTRICA DIGITAL DE CA", "Mide hasta 400A AC y 2 V a 600V")
    expect(a.tension_v).toBeUndefined()
    expect(a.corriente_a).toBeUndefined()
  })

  it("LAPIZ MULTÍMETRO DIGITAL", () => {
    const a = extraer("LAPIZ MULTÍMETRO DIGITAL", "Rango 4 V / 40V / 400V, 10 A")
    expect(a.tension_v).toBeUndefined()
    expect(a.corriente_a).toBeUndefined()
  })

  it("TESTER y VOLTÍMETRO también son instrumentos", () => {
    expect(extraer("TESTER DE TENSION", "12-1000V").tension_v).toBeUndefined()
    expect(extraer("VOLTIMETRO DIGITAL RIEL DIN", "80-500V").tension_v).toBeUndefined()
  })

  it("un instrumento conserva lo demás (IP)", () => {
    expect(extraer("MULTIMETRO DIGITAL IP67", "Rango 2V/20V")).toEqual({ ip: 67 })
  })

  it("CAJA VACÍA para contactor: la potencia del contactor no es la de la caja", () => {
    expect(extraer("CAJA VACÍA NQ3-11P para contactor NXC", "Para contactor de 11kW").potencia_w).toBeUndefined()
    expect(extraer("GABINETE ESTANCO", "Para contactor de 11kW").potencia_w).toBeUndefined()
  })

  it("la palabra en la DESCRIPCIÓN no descarta nada", () => {
    expect(extraer("FUENTE 12V 5A", "Compatible con multímetro").tension_v).toBe(12)
    expect(extraer("REFLECTOR LED 50W", "Se monta en gabinete").potencia_w).toBe(50)
  })

  it("guardamotor: sigue dando potencia y tensión", () => {
    const a = extraer("GUARDAMOTOR TM 0,37kW-400V")
    expect(a.potencia_w).toBe(370)
    expect(a.tension_v).toBe(400)
  })
})

describe("familias del nombre (montaje, largo en cm, accesorios sin palabra de caño o bandeja, tono abreviado)", () => {
  const solo = (clave: string) => (nombre: string, descripcion?: string) => {
    const v = extraer(nombre, descripcion)[clave]
    return v === undefined ? {} : { [clave]: v }
  }

  describe("montaje por familia de producto (sólo si el nombre no dice el montaje)", () => {
    const montaje = solo("montaje")
    it.each([
      // Familias: el plafón y el aplique se aplican; la araña y la luminaria de suspensión cuelgan.
      ["PLAFON LED 18W CUADRADO", { montaje: "aplicar" }],
      ["PLAFONIER E27 BLANCO", { montaje: "aplicar" }],
      ["PANEL PLAFON CIRCULAR 12W FRIO 6000K", { montaje: "aplicar" }],
      ["ARTEFACTO PLAFON DICRO X2 BLANCO", { montaje: "aplicar" }],
      ["APLIQUE LED", { montaje: "aplicar" }],
      ["Aplique bidireccional de polipropileno E27 IP44", { montaje: "aplicar" }],
      ["ARAÑA 4 BRAZOS", { montaje: "colgante" }],
      ["LUMINARIA DE SUSPENSION LED 40W", { montaje: "colgante" }],
      // Estanco (luminaria o gabinete/caja): se aplica.
      ["ESTANCO LED 50W FRIO 6500K", { montaje: "aplicar" }],
      ["ESTANCO TUBO 18W COMPATIBLE 1 TUBO LED T8", { montaje: "aplicar" }],
      ["GABINETE ESTANCO METALICO 300X300X150 PUERTA CIEGA", { montaje: "aplicar" }],
      ["Caja estanca plástica 115x165x80 tapa transparente IP65", { montaje: "aplicar" }],
      // El montaje dicho en el nombre manda sobre la familia.
      ["PLAFON LED EMBUTIR REDONDO 18W", { montaje: "embutir" }],
      ["ESTANCO LED DE EMBUTIR 20W", { montaje: "embutir" }],
      ["APLIQUE PARA RIEL MAGNETICO 12W", { montaje: "riel" }],
      ["PANEL LED DE EMBUTIR 18W", { montaje: "embutir" }],
      // Dos montajes en el nombre: ninguno (tampoco el de la familia).
      ["PLAFON EMBUTIR/APLICAR 24W", {}],
      ["COLGANTE ESFERICO PARA RIEL MAGNETICO 10W", {}],
      ["EXTENSOR PARA RIEL DE EMBUTIR O SUSPENSION", {}],
      // "Superficie" / "sobreponer" = de aplicar.
      ["Caja con tapa de superficie 3 módulos", { montaje: "aplicar" }],
      ["TOMA SUPERFICIE 3P+T 16A IP44", { montaje: "aplicar" }],
      ["PANEL LED SOBREPONER 24W", { montaje: "aplicar" }],
      // Negativos: suspensión que no es luminaria, accesorios "para" la familia, terminaciones de superficie.
      ["TRAPECIO DE SUSPENSION 200 GALVANIZADO", {}],
      ["KIT DE SUSPENSION DE CUADROS 200 PIEZAS", {}],
      ["ACCESORIO SUSPENSION PANEL LED", {}],
      ["SUJETADORES DE ACRILICO PARA APLIQUE DE TIRA NEON", {}],
      ["Bastidor con tapa estanca", {}],
      ["INTERRUPTOR BIPOLAR 30A C/ CAJA ESTANCA", {}],
      ["PRENSACABLE ESTANCO 20MM", {}],
      ["TUERCA HEXAGONAL CON SUPERFICIE GALVANIZADA", {}],
      ["MANIJA DE PUERTA SUPERFICIE CROMADA", {}],
      ["Soporte complementario para caja de superficie", {}],
      ["LAMPARA LED 9W E27", {}],
      ["DRIVER DE REPUESTO DE PANELES Y PLAFONES 12W", {}],
      ["Aplique tulipa cerrada para columna de 2\"", {}],
    ])("%s", (nombre, esperado) => expect(montaje(nombre as string)).toEqual(esperado))

    it("la familia y la superficie se leen sólo del nombre, no de la descripción", () => {
      expect(montaje("ARTEFACTO LED 20W", "Ideal para reemplazar plafones")).toEqual({})
      expect(montaje("ALICATE DE CORTE", "Superficie templada de alta dureza")).toEqual({})
      expect(montaje("ALICATE DE CORTE", "Corta sobre cualquier superficie")).toEqual({})
    })

    it("el valor externo acepta 'de superficie'", () => {
      expect(normalizarAtributos({ montaje: "de superficie" })).toEqual([{ clave: "montaje", valorNum: null, valorTexto: "aplicar" }])
    })
  })

  describe("largo_m desde centímetros (tubos, listones, regletas y tiras de luz)", () => {
    const largo = solo("largo_m")
    it.each([
      ["TUBO LED T8 18W 120CM FRIO", { largo_m: 1.2 }],
      ["TUBO VIDRIO 9W AC185-265V 60CM CALIDO 3000K", { largo_m: 0.6 }],
      ["LISTON LED T5 CON INTERRUPTOR, 90cm 13W, CALIDO", { largo_m: 0.9 }],
      ["Listón LED T5 con interruptor 18W 120 cm IP20", { largo_m: 1.2 }],
      ["LISTON PARA TUBO LED T8 150CM SIMPLE", { largo_m: 1.5 }],
      ["REGLETA LED 60 cm 9W", { largo_m: 0.6 }],
      ["TIRA LED 50CM 12V", { largo_m: 0.5 }],
      // Lo que ya leía en metros no cambia.
      ["TIRA LED 5MTS", { largo_m: 5 }],
      // Negativos: sin contexto de tubo/listón/tira de luz, diámetros, caños, dos largos distintos.
      ["Colgante globo Ø 60 cm, 3 luces", {}],
      ["LAMPARA 120CM", {}],
      ["Barral para ventilador de techo 120 cm", {}],
      ["TUBO TERMOCONTRAIBLE 100CM", {}],
      ["CINTA AISLADORA 50 CM", {}],
      ["TUBO LED 18W 120CM ROLLO 5M", {}],
      ["PANEL LED 60X60CM 40W", {}],
    ])("%s", (nombre, esperado) => expect(largo(nombre as string)).toEqual(esperado))
  })

  describe("diametro_mm de accesorios de caño sin la palabra caño", () => {
    it.each([
      ["Grampa abierta a presión 20 mm", { diametro_mm: 20 }],
      ["Unión rígida IP44 40 mm", { diametro_mm: 40 }],
      ["Curva rígida 90° radio estándar IP44 25 mm", { diametro_mm: 25 }],
      ["Curva 25mm", { diametro_mm: 25 }],
      // Pulgadas (designación comercial del caño eléctrico → mm de la serie métrica).
      ["Cupla 3/4", { diametro_mm: 20 }],
      ["CUPLA 7/8\"", { diametro_mm: 22 }],
      ["Curva 1\"", { diametro_mm: 25 }],
      ["Cupla 1 1/4\"", { diametro_mm: 32 }],
      ["Curva para caño 3/4", { diametro_mm: 20 }],
      // Negativos: conector suelto, fuera de la serie, aire comprimido, tuercas, dos medidas, piezas de bandeja.
      ["Conector 25mm", {}],
      ["Curva 12mm", {}],
      ["Unión rígida 20 mm y 25 mm", {}],
      ["CONECTOR RAPIDO DE AIRE ROSCA MACHO 1/4''", {}],
      ["CUPLA RAPIDA PARA MANGUERA 3/4", {}],
      ["TUERCA COMUN 3/4", {}],
      ["NIPLE 1/2 CINCADO", {}],
      ["Cupla 1/2", {}],
      ["Cupla 1", {}],
      ["Cupla perfil C 44 x 28", {}],
      ["CURVA 45º 300/50 0.7", { ancho_mm: 300 }],
      ["PINZA DE PUNTA CURVA 160MM", {}],
      ["TUBO 3/4 PULGADAS", {}],
      ["Conector de empalme de 2 conductores de hasta 4mm²", {}],
    ])("%s", (nombre, esperado) => expect(diaAncho(nombre as string)).toEqual(esperado))
  })

  describe("ancho_mm de accesorios de bandeja sin la palabra bandeja", () => {
    it.each([
      ["CURVA 45º 300/50 0.7 GALVANIZADA", { ancho_mm: 300 }],
      ["TEE 200/50", { ancho_mm: 200 }],
      ["CURVA PLANA 90º 150/50", { ancho_mm: 150 }],
      ["CRUZ 450/64 1.24", { ancho_mm: 450 }],
      ["REDUCCION 300/50 1.6", { ancho_mm: 300 }],
      ["D. PARALELA 100/50 0.7", { ancho_mm: 100 }],
      ["DERIVACION PERPENDICULAR 200/50", { ancho_mm: 200 }],
      ["PIEZA R. CENTRAL 250/50 0.7", { ancho_mm: 250 }],
      ["R.SIMPLE 75/92 1.24", { ancho_mm: 75 }],
      ["ACOMETIDA A TABLERO 300/50 0.9", { ancho_mm: 300 }],
      // Negativos: anchos fuera de serie, ala fuera de serie, otras relaciones, cajas, dos anchos.
      ["CURVA 90º 1200/50", {}],
      ["TEE 200/12", {}],
      ["CURVA 20/25", {}],
      ["Caja de derivación T de 3 vías para caño 20/25 mm", {}],
      ["INTERRUPTOR TERMOMAGNETICO 3P C80 230/400 V", {}],
      ["CURVA 90º 100/50 y 200/50", {}],
      ["TRANSFORMADOR DE CORRIENTE 1200/5A", {}],
    ])("%s", (nombre, esperado) => expect(diaAncho(nombre as string)).toEqual(esperado))
  })

  describe("tono desde WW / CW / NW", () => {
    const tono = solo("tono")
    it.each([
      ["REFLECTOR NEGRO CW", { tono: "frio" }],
      ["PANEL PLAFON WW", { tono: "calido" }],
      ["PANEL EMBUTIR NW", { tono: "neutro" }],
      ["MR16 8W 12V DIM WW", { tono: "calido" }],
      ["REFLECTOR XB-50W-CW", { tono: "frio" }],
      ["TUBO T8 150CM 25W-NW", { tono: "neutro" }],
      ["LAMPARA XY-WW-12", { tono: "calido" }],
      // Negativos: pegado a un número o a otro código, RGB+WW, dos tonos, otras siglas.
      ["BULBO E27 15CW", {}],
      ["LAMPARA AB-10WW", {}],
      ["PANEL XY18CWW", {}],
      ["SECCIONADOR 3P Icw 2kA", {}],
      ["REFLECTOR SMART 20W RGB+WW", { tono: "rgb" }],
      ["PANEL WW/CW", {}],
      ["PANEL CALIDO CW", {}],
    ])("%s", (nombre, esperado) => expect(tono(nombre as string)).toEqual(esperado))
  })

  it("relé térmico y guardamotor: el rango de regulación se lee como corriente con texto (ver abajo)", () => {
    expect(nuevas("RELE TERMICO 4-6A")).toEqual({ corriente_a: 6 })
    expect(nuevas("GUARDAMOTOR 1.6-2.5 A")).toEqual({ corriente_a: 2.5 })
  })
})

describe("rango de regulación de relés térmicos y guardamotores (corriente_a con valor_texto)", () => {
  const corriente = (nombre: string, descripcion?: string) =>
    extraerAtributosDeNombre(nombre, descripcion).find((a) => a.clave === "corriente_a") ?? null
  const rango = (texto: string, num: number) => ({ clave: "corriente_a", valorNum: num, valorTexto: texto })

  it.each([
    ["RELES DE SOBRECARGA TERMICOS NXR-25, 4-6A", "4-6", 6],
    ["RELES DE SOBRECARGA TERMICOS NXR-12, 1,6-2,5A", "1.6-2.5", 2.5],
    ["RELE TERMICO 1-1.6A", "1-1.6", 1.6],
    ["RELE TERMICO 13-18A", "13-18", 18],
    ["RELE TERMICO 4…6 A", "4-6", 6],
    ["RELE TERMICO 4 – 6 A", "4-6", 6],
    ["GUARDAMOTOR NS2-25X 1.6-2.5 A", "1.6-2.5", 2.5],
    ["GUARDAMOTOR 6A A 10A TRIFASICO", "6-10", 10],
    ["GUARDAMOTOR 4 A 6.3A TRIFASICO", "4-6.3", 6.3],
    ["GUARDAMOTOR 0.63 -1 A TRIFASICO", "0.63-1", 1],
    ["GUARDAMOTOR REGULACION 17-23", "17-23", 23],
    ["GUARDAMOTOR TM 0,25kW-400V - Reg: 0,63 - 1A - Icu: 100kA", "0.63-1", 1],
    ["Guardamotor magnetotérmico 9-14A 100kA", "9-14", 14],
    ["RELE PROTECTOR DE MOTOR - reg 8A a 40A - para 4 a 20 Kw", "8-40", 40],
    ["PROT.TERMICO MONOF 5-12A", "5-12", 12],
  ])("%s → %s A", (nombre, texto, num) => {
    expect(corriente(nombre as string)).toEqual(rango(texto as string, num as number))
  })

  it("también desde la descripción de Alegra (modelo y rango de ajuste iguales)", () => {
    expect(corriente("GUARDAMOTOR TM 0,37kW-400V", "Modelo: NS2-25X 1-1.6A\n- Rango de ajuste: 1-1,6 A")).toEqual(rango("1-1.6", 1.6))
  })

  it("el código del modelo no es un rango ('NS2-25X', 'NXR-25,')", () => {
    expect(corriente("GUARDAMOTOR NS2-25X")).toBeNull()
    expect(corriente("RELES DE SOBRECARGA TERMICOS NXR-25")).toBeNull()
  })

  it.each([
    // Sin contexto de relé/guardamotor, un "a-b A" no se lee: puede ser cualquier cosa.
    ["INTERRUPTOR CAJA MOLDEADA 3P 250A REG. ELEC. L:125-250A", 250],
    ["AMPERIMETRO 96X96 ANALOGICO 0-100A", null],
    ["SHUNT RELEASE 400V 315-1250A REGULABLE", null],
    ["BARRA COLECTORA DE PUESTA A TIERRA 1-19-125A", null],
    ["TRAFO DE CORRIENTE 1200/5A", null],
    ["FUENTE AC85-265V 5A", 5],
  ])("sin contexto: %s", (nombre, num) => {
    const c = corriente(nombre as string)
    expect(c?.valorTexto ?? null).toBeNull()
    expect(c?.valorNum ?? null).toBe(num)
  })

  it.each([
    // Con contexto pero sin rango de corriente: no se inventa.
    ["CAJA VACIA PARA GUARDAMOTOR NS2 HASTA 32A IP55", 32],
    ["GUARDAMOTOR 27A", 27],
    ["RELE TERMICO 85-265V", null],
    ["RELE PROTECTOR DE MOTOR para 4 a 20 Kw", null],
    ["GUARDAMOTOR REGULACION 6-4A", null],
  ])("con contexto y sin rango válido: %s", (nombre, num) => {
    const c = corriente(nombre as string)
    expect(c?.valorTexto ?? null).toBeNull()
    expect(c?.valorNum ?? null).toBe(num)
  })

  it("dos rangos distintos, o un rango y otra corriente: nada (ante la duda)", () => {
    expect(corriente("RELE TERMICO 4-6A / 6-10A")).toBeNull()
    expect(corriente("GUARDAMOTOR 4-6A 25A")).toBeNull()
    expect(corriente("GUARDAMOTOR 4-6A", "Rango de ajuste: 4-6 A")).toEqual(rango("4-6", 6))
  })

  it("no cambia las demás claves del producto", () => {
    expect(extraer("GUARDAMOTOR TM 0,25kW-400V - Reg: 0,63 - 1A - Icu: 100kA")).toMatchObject({ potencia_w: 250, tension_v: 400, poder_corte_ka: 100 })
  })
})

describe("normalizarAtributos: rango de regulación de corriente", () => {
  const n = (v: unknown) => normalizarAtributos({ corriente_a: v })
  it.each([
    ["4-6", 6, "4-6"],
    ["1,6-2,5", 2.5, "1.6-2.5"],
    ["0.63 – 1 A", 1, "0.63-1"],
    ["4-6A", 6, "4-6"],
  ])("%s → texto %s", (v, num, texto) => {
    expect(n(v)).toEqual([{ clave: "corriente_a", valorNum: num, valorTexto: texto }])
  })
  it("rango invertido, igual o fuera de rango: nada; un número sigue siendo número", () => {
    expect(n("6-4")).toEqual([])
    expect(n("4-4")).toEqual([])
    expect(n("4-9000")).toEqual([])
    expect(n("16")).toEqual([{ clave: "corriente_a", valorNum: 16, valorTexto: null }])
  })
})
