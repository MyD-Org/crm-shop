import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import casos from "./__fixtures__/envio-zona-casos.json"
import { cotizarMetodo, estimarPorLocalidad, resolverZona, type DestinoEnvio, type MetodoEnvio } from "./envio-zona"
import type { Geometria } from "./geo-poligono"

const geometrias = casos.geometrias as unknown as Record<string, Geometria>
const puntos = casos.puntos as Record<string, { lat: number; lon: number }>

function metodo(cambios: Partial<MetodoEnvio> = {}): MetodoEnvio {
  const base = casos.metodo
  return {
    ...(base as unknown as MetodoEnvio),
    zonas: base.zonas.map((z) => ({
      ...z,
      geometria: z.geometria ? geometrias[z.geometria] : [],
      entradas: z.entradas as MetodoEnvio["zonas"][number]["entradas"],
    })),
    ...cambios,
  }
}

function destino(d: Record<string, unknown>): DestinoEnvio {
  const { punto, ...resto } = d
  return {
    ...(resto as unknown as DestinoEnvio),
    punto: typeof punto === "string" ? { ...puntos[punto], precision: "altura" as const } : null,
  }
}

describe("resolverZona (fixture compartido con el Shop)", () => {
  for (const c of casos.resolver) {
    it(c.caso, () => {
      const r = resolverZona(metodo(), destino(c.destino))
      expect(r ? { zona: r.zona.nombre, regla: r.regla } : null).toEqual(c.esperado)
    })
  }
})

describe("estimarPorLocalidad (fixture compartido con el Shop)", () => {
  const localidades = casos.localidades as Record<string, Parameters<typeof estimarPorLocalidad>[1]>
  for (const c of casos.estimar) {
    it(c.caso, () => {
      expect(estimarPorLocalidad(metodo(), localidades[c.localidad])).toEqual(c.esperado)
    })
  }
})

describe("cotizarMetodo (fixture compartido con el Shop)", () => {
  for (const c of casos.cotizar) {
    it(c.caso, () => {
      const r = cotizarMetodo(
        metodo((c.cambios ?? {}) as Partial<MetodoEnvio>),
        destino(c.destino),
        c.ctx as Parameters<typeof cotizarMetodo>[2],
      )
      if (c.esperado === null) {
        expect(r).toBeNull()
        return
      }
      expect(r).toMatchObject(c.esperado)
    })
  }

  it("devuelve lo que el pedido congela: método, ítem Alegra, horario y precisión", () => {
    const r = cotizarMetodo(metodo(), destino({ provinciaClave: "buenosaires", punto: "centro" }), {
      origen: null,
      subtotalSinIva: 1,
      gratisTienda: false,
      gratisCupon: false,
    })
    expect(r).toMatchObject({
      metodoId: "m-1",
      slug: "envio-en-el-dia",
      zonaId: "z-centro",
      promesa: "Entrega en el día",
      precision: "altura",
      alegra: { itemId: "9001", ivaPct: 21 },
      horario: { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0 },
    })
  })
})

describe("fixture compartido con el Shop", () => {
  const delShop = join(process.cwd(), "../clientes/src/lib/__fixtures__/envio-zona-casos.json")
  // La copia del Shop llega con la rebanada B; desde entonces las dos tienen que ser idénticas.
  it.skipIf(!existsSync(delShop))("es idéntico byte a byte al del Shop (si cambia uno, cambia el otro)", () => {
    const propio = readFileSync(join(process.cwd(), "src/lib/__fixtures__/envio-zona-casos.json"))
    expect(readFileSync(delShop).equals(propio)).toBe(true)
  })
})
