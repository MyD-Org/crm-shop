// test/integration/marketing-piezas.integration.test.ts
import { beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { seedTenant, truncateAll } from "./helpers"
import {
  crearPieza,
  editarContenido,
  eventosDePieza,
  liberarClaimsVencidos,
  listarPiezas,
  obtenerPieza,
  reclamarPieza,
  transicionar,
} from "@/lib/marketing/piezas-repo"
import { guardarMarca } from "@/lib/marketing/marca-repo"

const T = "tenant-mkt"
const OTRO = "tenant-otro"
const base = { canal: "instagram", formato: "reel", plantilla: "producto-destacado", publico: "ambos", tema: "producto", objetivo: "alcance", produccion: "auto" } as const
const planificador = { tipo: "planificador", nombre: "rutina" } as const

describe("repo de piezas", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
    await seedTenant(OTRO)
  })

  it("una pieza automática nace en borrador; una semi sin material, esperando material", async () => {
    const auto = await crearPieza(T, { ...base, caption: "Hola" }, planificador)
    const semi = await crearPieza(T, { ...base, produccion: "semi", briefGrabacion: { guion: "Mostrá el local", tomas: ["frente"], duracionSeg: 20 } }, planificador)
    expect(auto.estado).toBe("borrador")
    expect(semi.estado).toBe("esperando_material")
    expect((await eventosDePieza(T, auto.id))[0]).toMatchObject({ de: null, a: "borrador", actor: "planificador:rutina" })
  })

  it("aplica las reglas de marca al crear", async () => {
    await guardarMarca(T, { reglas: [{ id: "abierta", texto: "No decir que la tienda está abierta", patron: "ya est[aá] abierta", severidad: "alta" }] })
    const p = await crearPieza(T, { ...base, caption: "La tienda ya está abierta" }, planificador)
    expect(p.alertas.map((a) => a.regla)).toEqual(["abierta"])
  })

  it("no ve piezas de otro tenant", async () => {
    const p = await crearPieza(OTRO, base, planificador)
    expect(await obtenerPieza(T, p.id)).toBeNull()
    expect(await listarPiezas(T, {})).toEqual([])
  })

  it("dos workers reclaman a la vez: sólo uno gana", async () => {
    const p = await crearPieza(T, base, planificador)
    const [a, b] = await Promise.all([reclamarPieza(T, p.id, "w1", 600), reclamarPieza(T, p.id, "w2", 600)])
    const ganadores = [a, b].filter(Boolean)
    expect(ganadores).toHaveLength(1)
    expect(ganadores[0]!.estado).toBe("renderizando")
  })

  it("un claim vencido vuelve a borrador y el PATCH tardío del worker se rechaza", async () => {
    const p = await crearPieza(T, base, planificador)
    await reclamarPieza(T, p.id, "w1", 600)
    await getDb().execute(sql`update marketing_piezas set claim_hasta = now() - interval '1 minute' where id = ${p.id}`)
    expect(await liberarClaimsVencidos(T)).toBe(1)
    expect((await obtenerPieza(T, p.id))!.estado).toBe("borrador")
    const tarde = await transicionar(T, p.id, "para_revisar", "studio", { worker: "w1", campos: { renderKey: "marketing/x.mp4" } })
    expect(tarde).toEqual({ ok: false, code: "conflict" })
  })

  it("el studio termina el render con su claim y la pieza pasa a revisión", async () => {
    const p = await crearPieza(T, base, planificador)
    await reclamarPieza(T, p.id, "w1", 600)
    const r = await transicionar(T, p.id, "para_revisar", "studio", { worker: "w1", campos: { renderKey: `marketing/${T}/render/a.mp4`, portadaKey: `marketing/${T}/render/a.jpg` } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pieza.estado).toBe("para_revisar")
      expect(r.pieza.claimPor).toBeNull()
      expect(r.pieza.renderKey).toBe(`marketing/${T}/render/a.mp4`)
    }
  })

  it("rechaza una transición que el actor no tiene permitida", async () => {
    const p = await crearPieza(T, base, planificador)
    expect(await transicionar(T, p.id, "aprobada", "studio")).toEqual({ ok: false, code: "invalid_transition" })
  })

  it("editar una pieza aprobada la versiona y borra el render viejo", async () => {
    const p = await crearPieza(T, base, planificador)
    await reclamarPieza(T, p.id, "w1", 600)
    await transicionar(T, p.id, "para_revisar", "studio", { worker: "w1", campos: { renderKey: "k.mp4", portadaKey: "k.jpg" } })
    await transicionar(T, p.id, "aprobada", "usuario", { nombreActor: "Ana" })
    const r = await editarContenido(T, p.id, { caption: "Nuevo caption" }, "Ana")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pieza).toMatchObject({ estado: "borrador", version: 2, renderKey: null, portadaKey: null, caption: "Nuevo caption" })
    }
  })

  it("no se edita una pieza que se está renderizando", async () => {
    const p = await crearPieza(T, base, planificador)
    await reclamarPieza(T, p.id, "w1", 600)
    expect(await editarContenido(T, p.id, { caption: "x" }, "Ana")).toEqual({ ok: false, code: "invalid_transition" })
  })

  it("lista por estado y por rango de fechas programadas", async () => {
    const lunes = new Date("2026-10-12T12:00:00Z")
    await crearPieza(T, { ...base, programadaPara: lunes }, planificador)
    await crearPieza(T, { ...base, programadaPara: new Date("2026-10-20T12:00:00Z") }, planificador)
    const semana = await listarPiezas(T, { desde: new Date("2026-10-12T00:00:00Z"), hasta: new Date("2026-10-19T00:00:00Z") })
    expect(semana).toHaveLength(1)
    expect(await listarPiezas(T, { estado: "borrador" })).toHaveLength(2)
  })
})
