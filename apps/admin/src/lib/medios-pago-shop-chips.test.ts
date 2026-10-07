import { describe, it, expect } from "vitest"
import { MAX_CHIPS, MAX_TEXTO_CHIP, TONOS_CHIP, TONO_BADGE_DE_CHIP, leerChips, moverChip, validarChips } from "@/lib/medios-pago-shop-chips"
import { validarMedioPagoCambios, validarMedioPagoNuevo } from "@/lib/medios-pago-shop-validacion"

describe("validarChips", () => {
  it("normaliza el texto (recorta) y conserva el orden y el tono", () => {
    const r = validarChips([
      { texto: "  Hasta 8 cuotas sin interés ", tono: "destacado" },
      { texto: "15% OFF", tono: "exito" },
    ])
    expect(r).toEqual({
      ok: true,
      chips: [
        { texto: "Hasta 8 cuotas sin interés", tono: "destacado" },
        { texto: "15% OFF", tono: "exito" },
      ],
    })
  })

  it("una lista vacía es válida (quita los chips)", () => {
    expect(validarChips([])).toEqual({ ok: true, chips: [] })
  })

  it("rechaza más de 3 chips, en usted", () => {
    const cuatro = Array.from({ length: MAX_CHIPS + 1 }, (_, i) => ({ texto: `Chip ${i}`, tono: "info" }))
    expect(validarChips(cuatro)).toEqual({ ok: false, error: "Cada medio de pago admite hasta 3 etiquetas." })
  })

  it("rechaza texto vacío o sólo espacios", () => {
    expect(validarChips([{ texto: "   ", tono: "info" }])).toEqual({ ok: false, error: "Ingrese el texto de la etiqueta." })
  })

  it("admite 30 caracteres y rechaza 31", () => {
    expect(validarChips([{ texto: "a".repeat(MAX_TEXTO_CHIP), tono: "info" }]).ok).toBe(true)
    expect(validarChips([{ texto: "a".repeat(MAX_TEXTO_CHIP + 1), tono: "info" }])).toEqual({
      ok: false,
      error: "El texto de la etiqueta admite hasta 30 caracteres.",
    })
  })

  it("rechaza HTML y caracteres de control", () => {
    for (const texto of ["<b>Oferta</b>", "Oferta <script>", "a > b", "uno\ndos", "tab\tx"]) {
      expect(validarChips([{ texto, tono: "info" }]).ok, texto).toBe(false)
    }
  })

  it("rechaza un tono desconocido o ausente", () => {
    expect(validarChips([{ texto: "Hola", tono: "rojo" }]).ok).toBe(false)
    expect(validarChips([{ texto: "Hola" }]).ok).toBe(false)
  })

  it("rechaza lo que no es una lista de objetos", () => {
    expect(validarChips("x").ok).toBe(false)
    expect(validarChips(null).ok).toBe(false)
    expect(validarChips([null]).ok).toBe(false)
    expect(validarChips(["Hola"]).ok).toBe(false)
    expect(validarChips([{ texto: 5, tono: "info" }]).ok).toBe(false)
  })

  it("ignora claves extra en cada chip", () => {
    expect(validarChips([{ texto: "Hola", tono: "info", color: "red" }])).toEqual({
      ok: true,
      chips: [{ texto: "Hola", tono: "info" }],
    })
  })
})

describe("leerChips (tolerante, para lo que viene de la base)", () => {
  it("lo inválido o ausente da []", () => {
    expect(leerChips(undefined)).toEqual([])
    expect(leerChips(null)).toEqual([])
    expect(leerChips("x")).toEqual([])
    expect(leerChips({})).toEqual([])
  })
  it("descarta los chips mal formados y conserva los buenos", () => {
    expect(
      leerChips([{ texto: "Bien", tono: "exito" }, { texto: "", tono: "info" }, 3, { texto: "x", tono: "otro" }]),
    ).toEqual([{ texto: "Bien", tono: "exito" }])
  })
  it("recorta a 3", () => {
    const cinco = Array.from({ length: 5 }, (_, i) => ({ texto: `C${i}`, tono: "info" }))
    expect(leerChips(cinco)).toHaveLength(3)
  })
})

describe("moverChip", () => {
  it("sube y baja una posición y no se sale de rango", () => {
    expect(moverChip(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"])
    expect(moverChip(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"])
    expect(moverChip(["a", "b"], 0, -1)).toEqual(["a", "b"])
    expect(moverChip(["a", "b"], 1, 1)).toEqual(["a", "b"])
  })
  it("no muta la lista original", () => {
    const orig = ["a", "b"]
    moverChip(orig, 0, 1)
    expect(orig).toEqual(["a", "b"])
  })
})

describe("TONO_BADGE_DE_CHIP", () => {
  it("cada tono del chip tiene un tono de Badge", () => {
    for (const t of TONOS_CHIP) expect(["warning", "success", "info"]).toContain(TONO_BADGE_DE_CHIP[t])
  })
})

describe("chips en la validación del medio", () => {
  it("el PATCH acepta chips válidos y rechaza los inválidos con campo 'chips'", () => {
    const ok = validarMedioPagoCambios({ chips: [{ texto: "Recomendado", tono: "destacado" }] })
    expect(ok.ok && ok.cambios.chips).toEqual([{ texto: "Recomendado", tono: "destacado" }])
    expect(validarMedioPagoCambios({ chips: [{ texto: "<i>x</i>", tono: "info" }] })).toMatchObject({ ok: false, campo: "chips" })
  })
  it("el alta acepta chips y por defecto no trae", () => {
    const base = { slug: "efectivo", nombre: "Efectivo" }
    const sin = validarMedioPagoNuevo(base)
    expect(sin.ok && sin.valor.chips).toBeUndefined()
    const con = validarMedioPagoNuevo({ ...base, chips: [{ texto: "Promo", tono: "info" }] })
    expect(con.ok && con.valor.chips).toEqual([{ texto: "Promo", tono: "info" }])
  })
})
