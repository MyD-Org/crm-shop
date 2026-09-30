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
