import { describe, expect, it } from "vitest"
import { conCambios, errorCorto, hayProblema, parsearArgs, resumir } from "./alegra-sync-runner"

describe("parsearArgs", () => {
  it("sin args: todos los tenants", () => {
    expect(parsearArgs([])).toEqual({ ok: true, tenant: null, aceptarBaja: false })
  })
  it("tenant y aceptar-baja", () => {
    expect(parsearArgs(["--tenant", "tenant-a", "--aceptar-baja"])).toEqual({ ok: true, tenant: "tenant-a", aceptarBaja: true })
  })
  it("aceptar-baja sin tenant es un error", () => {
    expect(parsearArgs(["--aceptar-baja"])).toMatchObject({ ok: false })
  })
  it("rechaza ids inválidos, vacíos y argumentos desconocidos", () => {
    expect(parsearArgs(["--tenant", "a;rm -rf"])).toMatchObject({ ok: false })
    expect(parsearArgs(["--tenant"])).toMatchObject({ ok: false })
    expect(parsearArgs(["--otra"])).toMatchObject({ ok: false })
  })
})

describe("resumir", () => {
  it("no filtra el detalle crudo de errores y conserva conteos por cuenta", () => {
    const r = resumir("tenant-a", {
      ok: false,
      itemsSynced: 10,
      categoriesSynced: 2,
      error: 'Alegra 500: {"message":"boom","token":"abc"} https://api.example/x',
      cuentas: [
        { cuenta: "mdp", ok: true, itemsSynced: 5, categoriesSynced: 1, pareados: 4 },
        { cuenta: "otra", ok: false, parcial: true, motivo: "items 5 < base 100", itemsSynced: 0, categoriesSynced: 0, error: "sync_failed" },
      ],
    })
    const json = JSON.stringify(r)
    expect(json).not.toContain("abc")
    expect(json).not.toContain("https")
    expect(r.error).toBe("detalle omitido (ver catalog_sync_log)")
    expect(r.cuentas?.[0]).toMatchObject({ cuenta: "mdp", ok: true, pareados: 4 })
    expect(r.cuentas?.[1]).toMatchObject({ parcial: true, error: "sync_failed" })
    expect(r.parcial).toBe(true)
    expect(hayProblema(r)).toBe(true)
    expect(conCambios(r)).toBe(true)
  })
  it("un mensaje corto pasa", () => {
    expect(errorCorto("sync_failed")).toBe("sync_failed")
    expect(errorCorto(undefined)).toBeUndefined()
  })
  it("ok sin cuentas", () => {
    const r = resumir("t", { ok: true, itemsSynced: 3, categoriesSynced: 1 })
    expect(r).toEqual({ tenant: "t", ok: true, parcial: false, motivo: undefined, error: undefined, itemsSynced: 3, categoriesSynced: 1 })
    expect(hayProblema(r)).toBe(false)
  })
})

describe("logDeProgreso", () => {
  it("imprime cada ~1.500 ítems de la principal y el inicio y fin de cada cuenta", async () => {
    const { logDeProgreso } = await import("./alegra-sync-runner")
    const lineas: string[] = []
    const on = logDeProgreso("central-led", (l) => lineas.push(l))
    on({ tipo: "cuenta-inicio", cuenta: "principal" })
    for (const leidos of [300, 900, 1500, 1800, 3000, 3300, 4500]) on({ tipo: "lectura", cuenta: "principal", leidos })
    on({ tipo: "cuenta-fin", cuenta: "principal", ok: true, itemsSynced: 4800 })
    on({ tipo: "cuenta-inicio", cuenta: "mdp" })
    on({ tipo: "cuenta-fin", cuenta: "mdp", ok: false, itemsSynced: 0 })
    expect(lineas).toEqual([
      "central-led · cuenta principal: empieza",
      "central-led · cuenta principal: 1.500 ítems leídos",
      "central-led · cuenta principal: 3.000 ítems leídos",
      "central-led · cuenta principal: 4.500 ítems leídos",
      "central-led · cuenta principal: terminó (4.800 ítems)",
      "central-led · cuenta mdp: empieza",
      "central-led · cuenta mdp: falló (0 ítems)",
    ])
  })
})
