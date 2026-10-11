import { describe, expect, it } from "vitest"
import { evaluarReglas, textosDePieza, validarFrases } from "./reglas"

const reglas = [
  { id: "tienda-abierta", texto: "La tienda online todavía no está abierta", patron: "ya está abierta|compra online ya", severidad: "alta" as const },
  { id: "direccion", texto: "Sin dirección exacta hasta confirmar", patron: "alberti 4221", severidad: "alta" as const },
  { id: "sin-patron", texto: "Voseo", severidad: "media" as const },
]

describe("reglas de marca", () => {
  it("detecta una frase prohibida sin importar mayúsculas", () => {
    const alertas = evaluarReglas(["Tu tienda online YA ESTÁ ABIERTA"], reglas)
    expect(alertas).toEqual([{ regla: "tienda-abierta", mensaje: "La tienda online todavía no está abierta", severidad: "alta", fuente: "regla" }])
  })

  it("reporta cada regla una sola vez aunque aparezca en varios textos", () => {
    const alertas = evaluarReglas(["Alberti 4221", "Te esperamos en alberti 4221"], reglas)
    expect(alertas.map((a) => a.regla)).toEqual(["direccion"])
  })

  it("ignora las reglas sin patrón (las revisa la IA)", () => {
    expect(evaluarReglas(["hola"], reglas)).toEqual([])
  })

  it("un patrón sin frases válidas no rompe: se reporta como inválido", () => {
    const alertas = evaluarReglas(["texto"], [{ id: "rota", texto: "Rota", patron: "|", severidad: "media" }])
    expect(alertas).toEqual([{ regla: "rota", mensaje: "La regla «Rota» tiene un patrón inválido", severidad: "media", fuente: "regla" }])
  })

  it("extrae todos los textos de la pieza, incluso anidados en el contenido", () => {
    const textos = textosDePieza({
      caption: "Caption",
      hashtags: ["#MarDelPlata"],
      contenido: { titulo: "Hola", lineas: [["Todo", "lo que"]], cantidad: 3, extra: { nota: "Anidado" } },
    })
    expect(textos).toEqual(["Caption", "#MarDelPlata", "Hola", "Todo", "lo que", "Anidado"])
  })

  it("compara sin distinguir mayúsculas, tildes ni espacios repetidos", () => {
    expect(evaluarReglas(["YA   ESTA ABIERTA"], reglas).map((a) => a.regla)).toEqual(["tienda-abierta"])
    expect(evaluarReglas(["Compra\nonline YA"], reglas).map((a) => a.regla)).toEqual(["tienda-abierta"])
  })

  it("una regla con varias frases salta con cualquiera de ellas", () => {
    const r = [{ id: "m", texto: "M", patron: "gratis | sin cargo|oferta única", severidad: "media" as const }]
    expect(evaluarReglas(["Envío SIN CARGO"], r)).toHaveLength(1)
    expect(evaluarReglas(["oferta unica"], r)).toHaveLength(1)
    expect(evaluarReglas(["envío pago"], r)).toEqual([])
  })

  it("un patrón con aspecto de regex se toma literalmente: no ejecuta nada y sólo coincide con ese texto", () => {
    const r = [{ id: "lit", texto: "Lit", patron: "((a+))+$", severidad: "alta" as const }]
    const t0 = Date.now()
    expect(evaluarReglas(["a".repeat(40) + "!", "aaaa"], r)).toEqual([])
    expect(Date.now() - t0).toBeLessThan(500)
    expect(evaluarReglas(["vea ((a+))+$ acá"], r)).toHaveLength(1)
  })

  it("sólo prueba los primeros 5000 caracteres de cada texto", () => {
    const r = [{ id: "r", texto: "R", patron: "prohibido", severidad: "media" as const }]
    expect(evaluarReglas(["x".repeat(5000) + "prohibido"], r)).toEqual([])
    expect(evaluarReglas(["prohibido" + "x".repeat(6000)], r)).toHaveLength(1)
  })

  it("un patrón que no pasa la validación se reporta como inválido y no lanza", () => {
    const largo = Array.from({ length: 21 }, (_, i) => `frase ${i}`).join("|")
    const alertas = evaluarReglas(["frase 1"], [{ id: "x", texto: "X", patron: largo, severidad: "alta" }])
    expect(alertas).toEqual([{ regla: "x", mensaje: "La regla «X» tiene un patrón inválido", severidad: "alta", fuente: "regla" }])
  })

  it("extrae todos los textos de la pieza, incluso anidados en el contenido", () => {
    const textos = textosDePieza({
      caption: "Caption",
      hashtags: ["#MarDelPlata"],
      contenido: { titulo: "Hola", lineas: [["Todo", "lo que"]], cantidad: 3, extra: { nota: "Anidado" } },
    })
    expect(textos).toEqual(["Caption", "#MarDelPlata", "Hola", "Todo", "lo que", "Anidado"])
  })
})

describe("validarFrases", () => {
  it("acepta una o varias frases", () => {
    expect(validarFrases("ya está abierta")).toBeNull()
    expect(validarFrases("ya está abierta| compra online ya |  alberti 4221")).toBeNull()
  })

  it("rechaza un patrón sin frases", () => {
    expect(validarFrases("")).not.toBeNull()
    expect(validarFrases(" | ")).not.toBeNull()
  })

  it("rechaza más de 20 frases", () => {
    expect(validarFrases(Array.from({ length: 21 }, (_, i) => `frase ${i}`).join("|"))).toMatch(/20/)
    expect(validarFrases(Array.from({ length: 20 }, (_, i) => `frase ${i}`).join("|"))).toBeNull()
  })

  it("rechaza una frase de menos de 2 o más de 80 caracteres", () => {
    expect(validarFrases("ok|a")).toMatch(/2/)
    expect(validarFrases("\u0301\u0301")).toMatch(/2/)
    expect(validarFrases("a".repeat(81))).toMatch(/80/)
    expect(validarFrases("a".repeat(80))).toBeNull()
  })

  it("rechaza un patrón de más de 300 caracteres", () => {
    expect(validarFrases(Array.from({ length: 10 }, () => "a".repeat(40)).join("|"))).toMatch(/300/)
  })
})
