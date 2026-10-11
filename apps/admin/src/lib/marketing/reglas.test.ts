import { describe, expect, it } from "vitest"
import { evaluarReglas, textosDePieza, validarPatron } from "./reglas"

const reglas = [
  { id: "tienda-abierta", texto: "La tienda online todavía no está abierta", patron: "ya est[aá] abierta|compr[aá] online ya", severidad: "alta" as const },
  { id: "direccion", texto: "Sin dirección exacta hasta confirmar", patron: "alberti\\s*\\d+", severidad: "alta" as const },
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

  it("una regex inválida no rompe: se reporta como regla_invalida", () => {
    const alertas = evaluarReglas(["texto"], [{ id: "rota", texto: "Rota", patron: "([", severidad: "media" }])
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

  it("una regla con patrón inseguro se trata como inválida y no se ejecuta", () => {
    const textos = ["a".repeat(40) + "!"]
    const alertas = evaluarReglas(textos, [{ id: "peligrosa", texto: "Peligrosa", patron: "(a+)+$", severidad: "alta" }])
    expect(alertas).toEqual([{ regla: "peligrosa", mensaje: "La regla «Peligrosa» tiene un patrón inválido", severidad: "alta", fuente: "regla" }])
  })

  it("sólo prueba los primeros 5000 caracteres de cada texto", () => {
    const largo = "x".repeat(5000) + "prohibido"
    expect(evaluarReglas([largo], [{ id: "r", texto: "R", patron: "prohibido", severidad: "media" }])).toEqual([])
    expect(evaluarReglas(["prohibido" + "x".repeat(6000)], [{ id: "r", texto: "R", patron: "prohibido", severidad: "media" }])).toHaveLength(1)
  })
})

describe("validarPatron", () => {
  it("acepta un patrón razonable", () => {
    expect(validarPatron("ya est[aá] abierta|alberti\\s*\\d+")).toBeNull()
  })

  it("rechaza un patrón de más de 200 caracteres", () => {
    expect(validarPatron("a".repeat(201))).toMatch(/200/)
  })

  it("rechaza un patrón que no compila", () => {
    expect(validarPatron("([")).toMatch(/válida|inválido/)
  })

  it.each(["(a+)+", "(\\w*)*", "(a|aa+)+", "(a{2,})*", "(?:a+)+b"])("rechaza cuantificadores anidados: %s", (patron) => {
    expect(validarPatron(patron)).not.toBeNull()
  })

  it("acepta un grupo cuantificado sin cuantificadores adentro", () => {
    expect(validarPatron("(ab|cd)+")).toBeNull()
  })
})
