// test/integration/marketing-otros.integration.test.ts
import { beforeEach, describe, expect, it } from "vitest"
import { seedTenant, truncateAll } from "./helpers"
import { crearPieza, obtenerPieza } from "@/lib/marketing/piezas-repo"
import {
  actualizarInteraccion,
  crearSolicitud,
  guardarInteraccion,
  guardarMetricas,
  listarInteracciones,
  listarMetricas,
  listarSolicitudes,
  registrarMaterial,
  resolverSolicitud,
} from "@/lib/marketing/otros-repo"

const T = "tenant-mkt"
const semi = { canal: "instagram", formato: "reel", plantilla: "clip-propio", publico: "ambos", tema: "marca_comunidad", objetivo: "local", produccion: "semi" } as const

describe("repos auxiliares de marketing", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
  })

  it("encola y resuelve una solicitud de plan", async () => {
    const s = await crearSolicitud(T, "plan_semana")
    expect((await listarSolicitudes(T, "pendiente")).map((x) => x.id)).toEqual([s.id])
    const r = await resolverSolicitud(T, s.id, true, "5 piezas creadas")
    expect(r).toMatchObject({ estado: "resuelta", resultado: "5 piezas creadas" })
    expect(await listarSolicitudes(T, "pendiente")).toEqual([])
  })

  it("subir material a una pieza que lo espera la pasa a borrador", async () => {
    const p = await crearPieza(T, semi, { tipo: "planificador", nombre: "rutina" })
    await registrarMaterial(T, { piezaId: p.id, archivoKey: `marketing/${T}/material/${p.id}/a.mp4`, tipo: "video", contentType: "video/mp4", bytes: 1000, subidoPor: null })
    expect((await obtenerPieza(T, p.id))!.estado).toBe("borrador")
  })

  it("las métricas se actualizan por (ámbito, ref, fecha)", async () => {
    await guardarMetricas(T, [{ ambito: "cuenta_ig", refId: "ig", fecha: "2026-10-12", metricas: { seguidores: 100 } }])
    await guardarMetricas(T, [{ ambito: "cuenta_ig", refId: "ig", fecha: "2026-10-12", metricas: { seguidores: 120 } }])
    const m = await listarMetricas(T, "2026-10-01", "2026-10-31")
    expect(m).toHaveLength(1)
    expect(m[0].metricas).toEqual({ seguidores: 120 })
  })

  it("una interacción repetida no pisa la ya tratada", async () => {
    const i = await guardarInteraccion(T, { origen: "comentario", externoId: "c1", autor: "@ana", texto: "¿Precio?", categoria: "consulta", sentimiento: "neutro", respuestaSugerida: "Le escribimos por privado" })
    await actualizarInteraccion(T, i.id, "aprobar", "¡Te escribimos por privado!")
    const repetida = await guardarInteraccion(T, { origen: "comentario", externoId: "c1", autor: "@ana", texto: "¿Precio?", categoria: "consulta", sentimiento: "neutro", respuestaSugerida: "Otra" })
    expect(repetida).toMatchObject({ id: i.id, estado: "aprobada", respuestaFinal: "¡Te escribimos por privado!" })
    expect(await listarInteracciones(T, "aprobada")).toHaveLength(1)
  })
})
