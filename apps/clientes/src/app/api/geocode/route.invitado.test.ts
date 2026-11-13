import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/geocode sin cuenta: sólo con la compra como invitado habilitada, un request del mismo sitio y
 * una IP; con techos por IP (minuto y día) y uno global para todos los invitados.
 */

let sesion: string | null = null;
let invitado = true;
const permitidas = new Map<string, boolean>();
vi.mock("@/lib/auth", () => ({ claveSolicitante: async () => sesion }));
vi.mock("@/lib/compra-invitado-flag", () => ({ compraInvitadoHabilitada: async () => invitado }));
vi.mock("@/lib/envio-zona-flag", () => ({ envioPorZonaHabilitado: async () => false }));
const permitir = vi.fn(async (clave: string) => permitidas.get(clave) ?? true);
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: (clave: string) => permitir(clave) }));
vi.mock("@/lib/marca", () => ({ getMarca: async () => ({}) }));
vi.mock("@/lib/marca-base", () => ({ idTecnico: () => "shop" }));

import { GET } from "./route";

const fetchMock = vi.fn<(url: string) => Promise<Response>>();
const pedir = (headers: Record<string, string>) =>
  GET(new Request("http://localhost/api/geocode?text=Av.%20Col%C3%B3n%202500", { headers }));
const delSitio = { "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.9" };

beforeEach(() => {
  sesion = null;
  invitado = true;
  permitidas.clear();
  permitir.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("/api/geocode sin cuenta", () => {
  it("con la compra como invitado habilitada responde y limita por IP, por día y global", async () => {
    const res = await pedir(delSitio);
    expect(res.status).toBe(200);
    expect(permitir.mock.calls.map((c) => c[0])).toEqual([
      "geocode:inv:ip:203.0.113.9",
      "geocode:inv:dia:203.0.113.9",
      "geocode:inv:global",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin el flag de invitado sigue exigiendo cuenta", async () => {
    invitado = false;
    expect((await pedir(delSitio)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un request que no viene del propio sitio se rechaza", async () => {
    expect((await pedir({ "x-forwarded-for": "203.0.113.9" })).status).toBe(401);
    expect((await pedir({ ...delSitio, "sec-fetch-site": "cross-site" })).status).toBe(401);
  });

  it("sin IP reconocible se rechaza", async () => {
    expect((await pedir({ "sec-fetch-site": "same-origin" })).status).toBe(401);
  });

  it("pasado el techo global responde 429 sin salir a Nominatim", async () => {
    permitidas.set("geocode:inv:global", false);
    expect((await pedir(delSitio)).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con cuenta usa el límite de siempre, por usuario", async () => {
    sesion = "clerk:u1";
    expect((await pedir({})).status).toBe(200);
    expect(permitir.mock.calls.map((c) => c[0])).toEqual(["geocode:clerk:u1"]);
  });
});
