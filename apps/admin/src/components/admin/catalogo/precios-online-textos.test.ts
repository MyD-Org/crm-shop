import { describe, it, expect } from "vitest"
import { TEXTOS, fmtCoef, fmtPct, fmtPrecio, textoOrigen } from "./precios-online-textos"
import { MSG_COEF, MSG_NOMBRE, MSG_SIN_CAMBIOS, MSG_UMBRAL } from "@/lib/precios-online-cambios"

// B.22: los textos del panel y los mensajes de la API van en español formal de USTED (nunca
// voseo ni "tú"), y los rótulos clave del producto están tal cual se pidieron.

/** Todas las cadenas de un árbol de textos, llamando a las funciones con argumentos de ejemplo. */
function cadenas(v: unknown, acc: string[] = []): string[] {
  if (typeof v === "string") acc.push(v)
  else if (typeof v === "function") {
    for (const args of [["x", true], [1, 2], ["x"], [3]] as unknown[][]) {
      try {
        const r = (v as (...a: unknown[]) => unknown)(...args)
        if (typeof r === "string") acc.push(r)
      } catch {
        /* firma distinta */
      }
    }
  } else if (v && typeof v === "object") for (const x of Object.values(v)) cadenas(x, acc)
  return acc
}

// Formas de voseo / tuteo que no pueden aparecer. Las palabras agudas legítimas se excluyen.
// ("\p{L}+rá": futuros de tercera persona: "mostrará", "podrá".)
const LEGITIMAS = /(?<![\p{L}])(está|así|aquí|allí|sí|más|además|después|interés|través|también|según|cuántos|éste|\p{L}+rá)(?![\p{L}])/giu
const PROHIBIDAS = [
  /(?<![\p{L}])(vos|tú|tu|tus|te|ti|contigo)(?![\p{L}])/iu,
  // Imperativos y presentes rioplatenses: "ingresá", "elegí", "tenés", "querés", "podés".
  /(?<![\p{L}])\p{L}{3,}(á|í|és|ás|ís)(?![\p{L}])/iu,
  /(?<![\p{L}])(ojo|che|dale|probá|fijate|mirá)(?![\p{L}])/iu,
]

describe("registro de usted", () => {
  const todas = cadenas(TEXTOS)
  it("hay textos que verificar", () => expect(todas.length).toBeGreaterThan(100))
  it.each(todas.map((t) => [t]))("sin voseo ni tuteo: %s", (texto) => {
    for (const re of PROHIBIDAS) {
      expect(texto.replace(LEGITIMAS, "").match(re), `${texto} → ${re}`).toBeNull()
    }
  })

  it("mensajes de la API en usted", () => {
    for (const m of [MSG_COEF, MSG_NOMBRE, MSG_SIN_CAMBIOS, MSG_UMBRAL]) {
      for (const re of PROHIBIDAS) expect(m.replace(LEGITIMAS, "").match(re), m).toBeNull()
    }
    expect(MSG_COEF).toBe("El coeficiente debe ser mayor o igual a 1.")
  })

  it("imperativos de usted en los botones y avisos", () => {
    expect(TEXTOS.previa.vencida).toBe("La vista previa quedó desactualizada. Genere una nueva.")
    expect(TEXTOS.grilla.sinListas).toMatch(/Cree la primera/)
    expect(TEXTOS.previa.confirmacionExtra(20)).toMatch(/escriba el nombre/)
    expect(TEXTOS.previa.errorGenerico).toMatch(/Inténtelo/)
  })
})

describe("rótulos fijados por el producto", () => {
  it("sin pendientes y referencia de Alegra", () => {
    expect(TEXTOS.sinPendientes).toBe("No hay productos pendientes.")
    expect(TEXTOS.grilla.referenciaTitulo).toBe("Referencia Alegra (solo informativo)")
  })
})

describe("formato", () => {
  it("precios, coeficientes y porcentajes", () => {
    expect(fmtPrecio(null)).toBe("—")
    expect(fmtPrecio("abc")).toBe("—")
    expect(fmtPrecio("150.5")).toMatch(/150,50/)
    expect(fmtCoef("1.6000")).toBe("1,6")
    expect(fmtCoef(null)).toBe("—")
    expect(fmtPct(10)).toBe("+10 %")
    expect(fmtPct(-6.67)).toBe("-6,67 %")
    expect(fmtPct(null)).toBe("—")
  })
  it("origen del coeficiente", () => {
    expect(textoOrigen({ tipo: "general" })).toBe("General")
    expect(textoOrigen({ tipo: "marca", marca: "marca x" })).toBe("Marca marca x")
    expect(textoOrigen({ tipo: "categoria", categoriaNombre: "Luminarias", heredado: true })).toBe("Categoría Luminarias (heredado)")
  })
})

describe("listas privadas", () => {
  it("la ayuda y los avisos explican en usted quién ve la lista y qué pasa al quitar enlaces", () => {
    expect(TEXTOS.listas.privadaAyuda).toContain("clientes con cuenta corriente")
    expect(TEXTOS.listas.enlaces).toBe("Corresponde a la lista de Alegra")
    expect(TEXTOS.listas.confirmarPublica("L5", 2)).toContain("Se quitarán sus 2 enlaces con listas de Alegra")
    expect(TEXTOS.listas.confirmarPublica("L5", 1)).toContain("Se quitará su enlace con listas de Alegra")
    expect(TEXTOS.listas.confirmarPublica("L5", 0)).not.toContain("enlace")
    expect(TEXTOS.listas.confirmarEliminar("L5", 1)).toContain("También se quitará su enlace")
    expect(TEXTOS.listas.confirmarEliminar("L5")).not.toContain("enlace")
    expect(TEXTOS.listas.contactos(0)).toBe("sin clientes")
    expect(TEXTOS.tipoCambio.mapeo).toBe("Enlace con lista de Alegra")
  })
})

describe("ajustes avanzados (umbrales)", () => {
  it("los rótulos y los tooltips explican en usted, con el ejemplo pedido", () => {
    expect(TEXTOS.listas.ajustesAvanzados).toBe("Ajustes avanzados")
    expect(TEXTOS.listas.umbralConfirmacionInfo).toContain("segunda confirmación")
    expect(TEXTOS.listas.umbralConfirmacionInfo).toContain("16 en vez de 1,6")
    expect(TEXTOS.listas.umbralRetencionInfo).toContain("Retenidos")
    expect(TEXTOS.listas.umbralRetencionInfo).toContain("usted lo apruebe")
  })
})
