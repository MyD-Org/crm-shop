import { describe, it, expect, beforeEach } from "vitest"
import { getDb } from "@/db"
import { catalogAtributosLegacy } from "@/db/schema"
import { truncateAll, seedTenant } from "./helpers"
import { upsertProyeccion } from "@/lib/plataforma-proyeccion-repo"
import { compararParidad } from "@/lib/plataforma-backfill"

const T = "central-led"

describe("paridad tabla legacy ↔ vista", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
  })

  it("sin diferencias cuando la proyección refleja la tabla; detecta lo que falta y lo distinto", async () => {
    await getDb().insert(catalogAtributosLegacy).values([
      { tenantId: T, alegraId: "42", clave: "potencia_w", valorNum: "20", valorTexto: null, fuente: "pdf" },
      { tenantId: T, alegraId: "42", clave: "tension_v", valorNum: "220", valorTexto: "85-265", fuente: "nombre" },
    ])
    await upsertProyeccion(T, "atributos_tecnicos", "42", "i", { potencia_w: { n: 20, t: null }, tension_v: { n: 220, t: "85-265" }, fuentes: { potencia_w: "pdf", tension_v: "nombre" } }, new Date())
    expect(await compararParidad(T)).toEqual({ soloTabla: [], soloVista: [], distintos: [] })

    await upsertProyeccion(T, "atributos_tecnicos", "42", "i", { potencia_w: { n: 18, t: null }, fuentes: { potencia_w: "pdf" } }, new Date(Date.now() + 1000))
    expect(await compararParidad(T)).toEqual({ soloTabla: ["42|tension_v"], soloVista: [], distintos: ["42|potencia_w"] })
  })

  it("compara valores numéricos, no texto: numeric '20.50' en la tabla y 20.5 en la proyección no son distintos", async () => {
    await getDb().insert(catalogAtributosLegacy).values({ tenantId: T, alegraId: "42", clave: "potencia_w", valorNum: "20.50", valorTexto: null, fuente: "pdf" })
    await upsertProyeccion(T, "atributos_tecnicos", "42", "i", { potencia_w: { n: 20.5, t: null }, fuentes: { potencia_w: "pdf" } }, new Date())
    expect(await compararParidad(T)).toEqual({ soloTabla: [], soloVista: [], distintos: [] })
  })

  it("detecta filas que sólo existen en la proyección (soloVista)", async () => {
    await upsertProyeccion(T, "atributos_tecnicos", "99", "i", { ip: { n: 65, t: null }, fuentes: { ip: "pdf" } }, new Date())
    expect(await compararParidad(T)).toEqual({ soloTabla: [], soloVista: ["99|ip"], distintos: [] })
  })
})
