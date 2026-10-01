import { describe, expect, it } from "vitest"
import {
  CLAVES_ATRIBUTO,
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
    expect(comoMapa(a)).toEqual({ potencia_w: 12, tension_v: 220, tono: "calido", temperatura_k: 3000 })
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
    expect(extraer("APLIQUE IPX4")).toEqual({})
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
    expect(comoMapa(normalizarAtributos({ tono: "violeta" }))).toEqual({})
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
        curva: "C", sensibilidad_ma: 30, largo_m: 100, montaje: "Embutir", angulo_grados: 60,
      }),
    ).toEqual({
      corriente_a: 25, polos: 2, seccion_mm2: 2.5, medidas_mm: "300x1200", color: "blanco", poder_corte_ka: 6,
      curva: "c", sensibilidad_ma: 30, largo_m: 100, montaje: "embutir", angulo_grados: 60,
    })
  })

  it.each([
    ["corriente_a", 0.05], ["corriente_a", 7000], ["polos", 6], ["polos", 0], ["polos", 2.5], ["seccion_mm2", 0.1],
    ["seccion_mm2", 2000], ["poder_corte_ka", 0.5], ["poder_corte_ka", 150], ["sensibilidad_ma", 2], ["sensibilidad_ma", 5000],
    ["largo_m", 0.01], ["largo_m", 5000], ["angulo_grados", 0], ["angulo_grados", 400], ["angulo_grados", 12.5],
  ])("%s = %s fuera de rango (o no entero) se descarta", (clave, valor) => {
    expect(n({ [clave]: valor })).toEqual({})
  })

  it("límites del rango se aceptan", () => {
    expect(n({ corriente_a: 0.1, polos: 1, seccion_mm2: 1000, poder_corte_ka: 100, sensibilidad_ma: 5, largo_m: 1000, angulo_grados: 360 })).toEqual({
      corriente_a: 0.1, polos: 1, seccion_mm2: 1000, poder_corte_ka: 100, sensibilidad_ma: 5, largo_m: 1000, angulo_grados: 360,
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
const NUEVAS = ["corriente_a", "polos", "seccion_mm2", "medidas_mm", "color", "poder_corte_ka", "curva", "sensibilidad_ma", "largo_m", "montaje", "angulo_grados"]
function nuevas(nombre: string): Record<string, number | string> {
  return Object.fromEntries(Object.entries(extraer(nombre)).filter(([k]) => NUEVAS.includes(k)))
}

describe("extracción de claves nuevas desde el nombre", () => {
  describe("seccion_mm2", () => {
    it.each([
      ["CABLE 2,5MM2", { seccion_mm2: 2.5 }],
      ["CABLE 3X1.5MM2", { seccion_mm2: 1.5 }],
      ["CABLE 4 MM²", { seccion_mm2: 4 }],
      ["CABLE 3X1.5MM2 ROLLO 100M", { seccion_mm2: 1.5, largo_m: 100 }],
      ["CABLE 2,5 MM", {}],
      ["CANO 20MM", {}],
      ["CABLE 3X1.5", {}],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
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
      ["CABLE 3X1.5", {}],
      ["PANEL 60X60", {}],
      ["CABLE 4X2,5 MM", {}],
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
      ["CABLE C 2X1", {}],
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
      ["RELE TERMICO 1-1.6A", {}],
      ["RELE TERMICO 13-18A", {}],
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
      ["TIRA 14W/M", {}],
      ["CONTACTOR NCH8-25M/20", {}],
      ["PORTALAMPARA GUIR-10MT-E27", {}],
      ["TIRA NEON LARGO 5M", { largo_m: 5 }],
    ])("%s", (nombre, esperado) => expect(nuevas(nombre as string)).toEqual(esperado))
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
      ["APLIQUE LED", {}],
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
