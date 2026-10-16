import { describe, it, expect, beforeEach, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { truncateAll, seedTenant } from "./helpers"

// El receptor registra la entrega y escribe la proyección en UNA transacción (revisión de la rama,
// T4): si la escritura tira después de escribir, no queda ni la entrega ni la fila, y el reintento
// con el MISMO delivery id se procesa. Repo real envuelto: `upsertProyeccion` puede fallar una vez
// DESPUÉS de haber escrito (lo peor: el efecto ya está en la transacción cuando falla).
const falla = vi.hoisted(() => ({ proxima: false }))
vi.mock("@/lib/plataforma-proyeccion-repo", async (orig) => {
  const real = await orig<typeof import("@/lib/plataforma-proyeccion-repo")>()
  return {
    ...real,
    upsertProyeccion: async (...args: Parameters<typeof real.upsertProyeccion>) => {
      const r = await real.upsertProyeccion(...args)
      if (falla.proxima) {
        falla.proxima = false
        throw new Error("caída después de escribir")
      }
      return r
    },
  }
})

import { procesarEvento, type EventDocument } from "@/lib/plataforma-receptor"

const T = "central-led"
const evento = (potencia: number): EventDocument => ({
  id: "e1", account_id: "a", source: "entity", action: "atributos_tecnicos:update", resource: "r", actor: "app:crm",
  occurred_at: "2026-10-15T12:00:00Z", version: 1,
  payload: { instance: { id: "i1", spec: "atributos_tecnicos", spec_version: 1, external_key: "42", data: { potencia_w: { n: potencia, t: null }, fuentes: { potencia_w: "pdf" } }, anchors: {}, updated_at: "2026-10-15T12:00:00.000Z" } },
})
const entregas = async () => (await getDb().execute(sql`select delivery_id from plataforma_entregas where tenant_id = ${T}`)).map((f) => f.delivery_id)
const potencia = async () => (await getDb().execute(sql`select data->'potencia_w'->>'n' as n from catalog_proyeccion where tenant_id = ${T} and external_key = '42'`))[0]?.n ?? null

describe("receptor: registrar la entrega y escribir es atómico", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
    falla.proxima = false
  })

  it("si la escritura tira dentro de la transacción no queda nada, y el reintento con el mismo delivery id se procesa", async () => {
    falla.proxima = true
    await expect(procesarEvento(T, "d1", evento(20))).rejects.toThrow("caída después de escribir")
    expect(await entregas()).toEqual([])
    expect(await potencia()).toBeNull()

    expect(await procesarEvento(T, "d1", evento(20))).toBe("procesado")
    expect(await entregas()).toEqual(["d1"])
    expect(await potencia()).toBe("20")
  })

  it("idempotencia intacta: la misma entrega procesada dos veces sale 'repetido' y no escribe", async () => {
    expect(await procesarEvento(T, "d2", evento(20))).toBe("procesado")
    expect(await procesarEvento(T, "d2", evento(30))).toBe("repetido")
    expect(await potencia()).toBe("20")
  })
})
