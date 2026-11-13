import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeorefError, type SugerenciaLocalidad } from "@/lib/georef";

/**
 * /api/ubicacion/localidades: con el flag `envio-por-zona` apagado es la ruta de siempre; prendido prioriza
 * las localidades del comercio y entiende abreviaturas ("mdp"), y responde con ellas si Georef cae.
 */

let flag = true;
let georef: SugerenciaLocalidad[] | "error" = [];
const buscar = vi.fn(async (q: string) => {
  void q;
  if (georef === "error") throw new GeorefError("timeout");
  return georef;
});

vi.mock("@/lib/envio-zona-flag", () => ({ envioPorZonaHabilitado: async () => flag }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/ubicacion-api", async () => {
  const real = await vi.importActual<typeof import("@/lib/ubicacion-api")>("@/lib/ubicacion-api");
  return { ...real, ipDe: () => "ip" };
});
vi.mock("@/lib/georef", async () => {
  const real = await vi.importActual<typeof import("@/lib/georef")>("@/lib/georef");
  return { ...real, buscarLocalidades: (q: string) => buscar(q) };
});
vi.mock("@/lib/sucursales-datos", () => ({
  reglasVentaCacheadas: async () => ({
    envio: {
      domicilioActivo: true,
      gratis: null,
      metodos: [
        {
          id: "m1",
          activo: true,
          provinciaClave: "buenosaires",
          localidades: [{ georefId: "1", etiqueta: "Mar del Plata", abreviaturas: ["mdp"] }],
        },
      ],
    },
  }),
  sucursalesCacheadas: async () => ({ sucursales: [], zonas: [] }),
}));

import { GET } from "./route";

const g = (id: string, localidad: string): SugerenciaLocalidad => ({ id, localidad, provincia: "buenosaires", provinciaNombre: "Buenos Aires" });
const get = (q: string) => GET(new Request(`http://localhost/api/ubicacion/localidades?q=${encodeURIComponent(q)}`));

beforeEach(() => {
  flag = true;
  georef = [];
  buscar.mockClear();
});

describe("/api/ubicacion/localidades", () => {
  it("flag apagado: la respuesta de Georef tal cual, y con menos de 4 caracteres no consulta", async () => {
    flag = false;
    georef = [g("9", "Mar del Tuyú"), g("1", "Mar del Plata")];
    const r = await (await get("mar del")).json();
    expect(r.localidades.map((l: { id: string }) => l.id)).toEqual(["9", "1"]);
    expect(await (await get("mdp")).json()).toEqual({ localidades: [] });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('"mar del" pone Mar del Plata primero', async () => {
    georef = [g("9", "Mar del Tuyú"), g("1", "Mar del Plata")];
    const r = await (await get("mar del")).json();
    expect(r.localidades.map((l: { id: string }) => l.id)).toEqual(["1", "9"]);
  });

  it('"mdp" responde con menos de 4 caracteres sin llamar a Georef', async () => {
    const r = await (await get("mdp")).json();
    expect(r.localidades).toEqual([{ id: "1", etiqueta: "Mar del Plata — Buenos Aires" }]);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("Georef caído y coincide un local: 200 con el local", async () => {
    georef = "error";
    const res = await get("mar del");
    expect(res.status).toBe(200);
    expect((await res.json()).localidades).toEqual([{ id: "1", etiqueta: "Mar del Plata — Buenos Aires" }]);
  });

  it("Georef caído y sin coincidencias: 502 como siempre", async () => {
    georef = "error";
    expect((await get("rosario")).status).toBe(502);
  });
});
