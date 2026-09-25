import { describe, expect, it } from "vitest"
import vector from "./__fixtures__/impuestos-alegra.json"
import { sumaImpuestos } from "./alegra-impuestos"

// Vector compartido con el test de integración de 0037: la misma tabla se evalúa contra
// public.alegra_suma_impuestos en Postgres. Si este test y aquel pasan, TS = SQL.

type Caso = { caso: string; tax?: unknown; esperado: string | null }

describe("sumaImpuestos (vector compartido con alegra_suma_impuestos)", () => {
  it.each((vector as Caso[]).map((c) => [c.caso, c] as const))("%s", (_nombre, c) => {
    const r = sumaImpuestos(c.tax)
    expect(r === null ? null : r.toFixed(2)).toBe(c.esperado)
  })
})
