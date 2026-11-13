/**
 * Método de envío de PRUEBA armado desde el fixture compartido con el CRM
 * (`src/lib/__fixtures__/envio-zona-casos.json`, geometrías sintéticas). Sólo para tests.
 */
import casos from "@/lib/__fixtures__/envio-zona-casos.json";
import type { MetodoEnvio, LocalidadAtendida } from "@/lib/envio-zona";
import type { Geometria } from "@/lib/geo-poligono";

const geometrias = casos.geometrias as unknown as Record<string, Geometria>

export const PUNTOS = casos.puntos as Record<string, { lat: number; lon: number }>;

export function metodoDePrueba(cambios: Partial<MetodoEnvio> = {}): MetodoEnvio {
  const base = casos.metodo;
  const localidades = Object.values(casos.localidades).map((l) => ({
    ...(l as unknown as LocalidadAtendida),
  }));
  return {
    ...(base as unknown as MetodoEnvio),
    zonas: base.zonas.map((z) => ({
      ...z,
      geometria: z.geometria ? geometrias[z.geometria] : [],
      entradas: z.entradas as MetodoEnvio["zonas"][number]["entradas"],
    })),
    localidades,
    ...cambios,
  };
}

/** Punto verificado del fixture, con la precisión indicada. */
export function puntoDePrueba(nombre: keyof typeof PUNTOS, precision: "altura" | "calle" = "altura") {
  return { ...PUNTOS[nombre], precision };
}
