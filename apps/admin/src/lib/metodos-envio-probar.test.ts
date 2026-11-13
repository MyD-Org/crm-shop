import { describe, it, expect } from "vitest"
import casos from "./__fixtures__/envio-zona-casos.json"
import type { Geometria } from "./geo-poligono"
import type { MetodoEnvio } from "./envio-zona"
import { metodoDeBorrador, probarDireccion, probarLocalidad } from "./metodos-envio-probar"
import { validarMetodoEnvio } from "./metodos-envio-validacion"

const geometrias = casos.geometrias as unknown as Record<string, Geometria>
const puntos = casos.puntos as Record<string, { lat: number; lon: number }>
const localidades = casos.localidades as Record<string, { georefId: string }>

const metodo: MetodoEnvio = {
  ...(casos.metodo as unknown as MetodoEnvio),
  zonas: casos.metodo.zonas.map((z) => ({
    ...z,
    geometria: z.geometria ? geometrias[z.geometria] : [],
    entradas: z.entradas as MetodoEnvio["zonas"][number]["entradas"],
  })),
  localidades: Object.values(casos.localidades) as never,
}

// Martes 10/11/2026 08:30 hora argentina.
const ANTES_DEL_CORTE = new Date("2026-11-10T11:30:00Z")
const DESPUES_DEL_CORTE = new Date("2026-11-10T13:00:00Z")

describe("probarDireccion", () => {
  it("zona, regla, precio y promesa de un punto; entrega el mismo día antes del corte", () => {
    const r = probarDireccion(metodo, { punto: { ...puntos.centro, precision: "altura" } }, ANTES_DEL_CORTE)
    expect(r).toMatchObject({
      aplica: true,
      zona: "Centro",
      zonaId: "z-centro",
      regla: "poligono",
      precio: 3000,
      promesa: "Entrega en el día",
      precision: "altura",
      entrega: { fecha: "2026-11-10", mismoDia: true },
    })
  })
  it("después del corte pasa al día hábil siguiente", () => {
    const r = probarDireccion(metodo, { punto: { ...puntos.centro, precision: "altura" } }, DESPUES_DEL_CORTE)
    expect(r).toMatchObject({ aplica: true, entrega: { fecha: "2026-11-11", mismoDia: false } })
  })
  it("punto aproximado (sólo calle) lo informa", () => {
    const r = probarDireccion(metodo, { punto: { ...puntos.centro, precision: "calle" } }, ANTES_DEL_CORTE)
    expect(r).toMatchObject({ aplica: true, precision: "calle" })
    expect(r.mensaje).toMatch(/aproximad/i)
  })
  it("sin zona: costo a coordinar", () => {
    const r = probarDireccion(metodo, { punto: { ...puntos.afuera, precision: "altura" } }, ANTES_DEL_CORTE)
    expect(r).toEqual({ aplica: false, mensaje: "Sin zona: costo a coordinar." })
  })
  it("el método se prueba aunque esté inactivo o tenga sucursal de origen", () => {
    const r = probarDireccion({ ...metodo, activo: false }, { punto: { ...puntos.costa, precision: "altura" } }, ANTES_DEL_CORTE)
    expect(r).toMatchObject({ aplica: true, zona: "Costa" })
  })
  it("respaldo por CP cuando el punto cae afuera", () => {
    const r = probarDireccion(metodo, { punto: { ...puntos.afuera, precision: "altura" }, cp: "7600" }, ANTES_DEL_CORTE)
    expect(r).toMatchObject({ aplica: true, zona: "Centro", regla: "cp" })
  })
})

describe("probarLocalidad", () => {
  it("exacto", async () => {
    const r = await probarLocalidad(metodo, localidades.costa.georefId)
    expect(r).toMatchObject({ aplica: true, estimado: { tipo: "exacto", precio: 4500, zona: "Costa" } })
    expect(r.mensaje).toMatch(/4\.500|4500/)
  })
  it("desde", async () => {
    const r = await probarLocalidad(metodo, localidades.mixta.georefId)
    expect(r).toMatchObject({ aplica: true, estimado: { tipo: "desde", precio: 3000 } })
    expect(r.mensaje).toMatch(/desde/i)
  })
  it("sin zona", async () => {
    expect(await probarLocalidad(metodo, localidades.ignota.georefId)).toEqual({
      aplica: false,
      mensaje: "Sin zona: costo a coordinar.",
    })
  })
  it("una localidad que el método no tiene cargada se completa con la función recibida", async () => {
    const r = await probarLocalidad({ ...metodo, localidades: [] }, "9990001", async () => ({
      centro: null,
      bbox: { sur: -38.04, oeste: -57.49, norte: -37.96, este: -57.41 },
    }))
    expect(r).toMatchObject({ aplica: true, estimado: { tipo: "exacto", precio: 4500 } })
  })
})

describe("metodoDeBorrador", () => {
  it("convierte un método validado (sin guardar) a la forma de los módulos puros, activo", () => {
    const v = validarMetodoEnvio({
      nombre: "Envío en el día",
      provincia: "Buenos Aires",
      diasOperativos: [1, 2, 3, 4, 5],
      horaCorte: "09:00",
      margenMin: 0,
      activo: false,
      zonas: [
        { nombre: "Centro", precio: 3000, geometria: geometrias.centro },
        { nombre: "Rural", precio: 9000, entradas: [{ tipo: "georef", valor: "9990003", etiqueta: "Pueblo Lejano — Buenos Aires" }] },
      ],
    })
    if (!v.ok) throw new Error(v.error)
    const m = metodoDeBorrador(v.metodo)
    expect(m.activo).toBe(true)
    expect(m.provinciaClave).toBe("buenosaires")
    expect(m.zonas[1].entradas[0]).toMatchObject({ tipo: "georef", valor: "9990003", nombreNorm: "pueblolejano" })
    expect(probarDireccion(m, { punto: { ...puntos.centro, precision: "altura" } }, ANTES_DEL_CORTE)).toMatchObject({ aplica: true, zona: "Centro" })
  })
})
