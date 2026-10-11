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
    await guardarMarca(T, { reglas: [{ id: "abierta", texto: "No decir que la tienda está abierta", patron: "ya está abierta", severidad: "alta" }] })
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
    const guardada = await obtenerPieza(T, p.id)
    expect(guardada!.claimPor).toBe(ganadores[0]!.claimPor)
    expect(["w1", "w2"]).toContain(guardada!.claimPor)
  })

  it("un claim vencido vuelve a borrador y el PATCH tardío del worker se rechaza", async () => {
    const p = await crearPieza(T, base, planificador)
    await reclamarPieza(T, p.id, "w1", 600)
    await getDb().execute(sql`update marketing_piezas set claim_hasta = now() - interval '1 minute' where id = ${p.id}`)
    expect(await liberarClaimsVencidos(T)).toBe(1)
    expect((await obtenerPieza(T, p.id))!.estado).toBe("borrador")
    const tarde = await transicionar(T, p.id, "para_revisar", "studio", { worker: "w1", campos: { renderKey: "marketing/x.mp4" } })
    expect(tarde).toEqual({ ok: false, code: "conflict" })
    const despues = await obtenerPieza(T, p.id)
    expect(despues).toMatchObject({ estado: "borrador", renderKey: null, claimPor: null })
  })

  it("un claim retomado por otro worker no se pisa con el PATCH tardío del primero", async () => {
    const p = await crearPieza(T, base, planificador)
    await reclamarPieza(T, p.id, "w1", 600)
    await getDb().execute(sql`update marketing_piezas set claim_hasta = now() - interval '1 minute' where id = ${p.id}`)
    expect(await liberarClaimsVencidos(T)).toBe(1)
    expect((await reclamarPieza(T, p.id, "w2", 600))?.claimPor).toBe("w2")
    const tarde = await transicionar(T, p.id, "para_revisar", "studio", { worker: "w1", campos: { renderKey: "marketing/x.mp4" } })
    expect(tarde).toEqual({ ok: false, code: "conflict" })
    const despues = await obtenerPieza(T, p.id)
    expect(despues).toMatchObject({ estado: "renderizando", claimPor: "w2", renderKey: null })
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

  it("dos ediciones concurrentes de la misma pieza: una gana y la otra recibe conflict", async () => {
    const p = await crearPieza(T, base, planificador)
    const [a, b] = await Promise.all([
      editarContenido(T, p.id, { caption: "Caption A" }, "Ana"),
      editarContenido(T, p.id, { hashtags: ["#b"] }, "Beto"),
    ])
    const oks = [a, b].filter((r) => r.ok)
    expect(oks).toHaveLength(1)
    const perdedor = [a, b].find((r) => !r.ok)
    expect(perdedor).toEqual({ ok: false, code: "conflict" })
    expect((await obtenerPieza(T, p.id))!.version).toBe(2)
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

  it("sinFecha trae las piezas sin programadaPara vivas (incluye esperando material) y excluye descartadas y publicadas", async () => {
    const semi = await crearPieza(T, { ...base, produccion: "semi", briefGrabacion: { guion: "g", tomas: ["t"], duracionSeg: 10 } }, planificador)
    const borrador = await crearPieza(T, base, planificador)
    const conFecha = await crearPieza(T, { ...base, programadaPara: new Date("2026-10-13T12:00:00Z") }, planificador)
    const descartada = await crearPieza(T, base, planificador)
    await transicionar(T, descartada.id, "descartada", "usuario", { nombreActor: "Ana" })
    const publicada = await crearPieza(T, base, planificador)
    await getDb().execute(sql`update marketing_piezas set estado = 'publicada' where id = ${publicada.id}`)
    const otro = await crearPieza(OTRO, base, planificador)
    const ids = (await listarPiezas(T, { sinFecha: true })).map((x) => x.id)
    expect(ids).toContain(semi.id)
    expect(ids).toContain(borrador.id)
    expect(ids).not.toContain(conFecha.id)
    expect(ids).not.toContain(descartada.id)
    expect(ids).not.toContain(publicada.id)
    expect(ids).not.toContain(otro.id)
  })

  it("listarPiezas devuelve como máximo 500 filas", async () => {
    await getDb().execute(
      sql`insert into marketing_piezas (tenant_id, canal, formato, plantilla, publico, tema, objetivo, produccion)
          select ${T}, 'instagram', 'reel', 'x', 'ambos', 'producto', 'alcance', 'auto' from generate_series(1, 505)`,
    )
    expect(await listarPiezas(T, {})).toHaveLength(500)
  })

  it("guardar sin cambios reales no versiona, no borra el render ni deja evento", async () => {
    const p = await crearPieza(T, { ...base, caption: "Hola", hashtags: ["#a"], contenido: { titulo: "T", lineas: ["x"] } }, planificador)
    await reclamarPieza(T, p.id, "w1", 600)
    await transicionar(T, p.id, "para_revisar", "studio", { worker: "w1", campos: { renderKey: "k.mp4", portadaKey: "k.jpg" } })
    const antes = await obtenerPieza(T, p.id)
    const eventosAntes = (await eventosDePieza(T, p.id)).length
    const r = await editarContenido(T, p.id, { caption: "Hola", hashtags: ["#a"], contenido: { lineas: ["x"], titulo: "T" } }, "Ana")
    expect(r.ok).toBe(true)
    const despues = await obtenerPieza(T, p.id)
    expect(despues).toEqual(antes)
    expect(despues).toMatchObject({ estado: "para_revisar", version: antes!.version, renderKey: "k.mp4" })
    expect((await eventosDePieza(T, p.id)).length).toBe(eventosAntes)
  })
})
