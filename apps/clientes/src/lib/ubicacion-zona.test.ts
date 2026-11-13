import { describe, expect, it } from "vitest";
import { localidadAtendidaEn } from "./ubicacion-zona";
import type { MetodoEnvio } from "./envio-zona";

const metodo = (over: Partial<MetodoEnvio> = {}): MetodoEnvio =>
  ({
    activo: true,
    provinciaClave: "buenosaires",
    zonas: [],
    localidades: [
      { georefId: "06357110", etiqueta: "Mar del Plata — Buenos Aires", bbox: { sur: -38.1, norte: -37.9, oeste: -57.7, este: -57.5 } },
      { georefId: "0635711001", etiqueta: "Camet — Buenos Aires", bbox: { sur: -37.92, norte: -37.88, oeste: -57.56, este: -57.5 } },
    ],
    ...over,
  }) as unknown as MetodoEnvio;

describe("localidadAtendidaEn", () => {
  it("devuelve la localidad atendida cuyo rectángulo contiene el punto", () => {
    expect(localidadAtendidaEn([metodo()], "buenosaires", -38.0, -57.55)).toEqual({ localidad: "Mar del Plata", id: "06357110" });
  });
  it("con dos que lo contienen, la más chica", () => {
    expect(localidadAtendidaEn([metodo()], "buenosaires", -37.91, -57.53)).toEqual({ localidad: "Camet", id: "0635711001" });
  });
  it("fuera de todas, otra provincia o método inactivo: null", () => {
    expect(localidadAtendidaEn([metodo()], "buenosaires", -34.6, -58.4)).toBeNull();
    expect(localidadAtendidaEn([metodo()], "misiones", -38.0, -57.55)).toBeNull();
    expect(localidadAtendidaEn([metodo({ activo: false })], "buenosaires", -38.0, -57.55)).toBeNull();
    expect(localidadAtendidaEn(undefined, "buenosaires", -38.0, -57.55)).toBeNull();
  });
});
