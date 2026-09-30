import { describe, expect, it } from "vitest"
import {
  CLAVES_ATRIBUTO,
  extraerAtributosDeNombre,
  normalizarAtributos,
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
    expect(extraer("Int. Termomagnético NXB-125. 100A. Icn:10kA. Curva D. 4P")).toEqual({})
  })

  it("AMOLADORA ANGULAR 2000W", () => {
    expect(extraer("AMOLADORA ANGULAR 2000W")).toEqual({ potencia_w: 2000 })
  })

  it("CONTACTOR con bobina de 24 VCA → tensión 24 (9A es corriente)", () => {
    expect(extraer("CONTACTOR 3P 9A 1NA Bob: 24VCA")).toEqual({ tension_v: 24 })
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
    expect(extraer("FUENTE 12V 5A")).toEqual({ tension_v: 12 })
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
          color: "rojo",
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
