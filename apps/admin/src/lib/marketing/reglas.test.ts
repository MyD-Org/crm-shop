import { describe, expect, it } from "vitest"
import { evaluarReglas, textosDePieza } from "./reglas"

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
})
