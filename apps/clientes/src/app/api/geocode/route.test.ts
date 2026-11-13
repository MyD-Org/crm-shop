import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/geocode con el envío por zona: consulta acotada a la localidad (estructurada + un reintento en
 * texto libre, sin caída a búsqueda nacional), coordenadas, precisión y `geoToken` firmado. Con el flag
 * apagado la respuesta es la de siempre (sin lat/lon/token).
 */

let flag = true;
vi.mock("@/lib/envio-zona-flag", () => ({ envioPorZonaHabilitado: async () => flag }));
vi.mock("@/lib/auth", () => ({ claveSolicitante: async () => "clerk:u1" }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/marca", () => ({ getMarca: async () => ({}) }));
vi.mock("@/lib/marca-base", () => ({ idTecnico: () => "shop" }));

import { GET } from "./route";
import { verificarGeo } from "@/lib/geo-token";

const SECRETO = "s3cr3t-placeholder-para-tests-pedidos-0123456789";

const colon = {
  display_name: "x",
  lat: "-37.99",
  lon: "-57.55",
  address: { road: "Avenida Colón", house_number: "2500", city: "Mar del Plata", state: "Buenos Aires", postcode: "7600", suburb: "Centro" },
};
const sinAltura = { ...colon, address: { ...colon.address, house_number: undefined } };

const fetchMock = vi.fn<(url: string) => Promise<Response>>();
const respuesta = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200 });
const get = (qs: string) => GET(new Request(`http://localhost/api/geocode?${qs}`));
const urls = () => fetchMock.mock.calls.map((c) => new URL(c[0]));

beforeEach(() => {
  flag = true;
  process.env.GEOCODE_FIRMA_SECRET = SECRETO;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEOCODE_FIRMA_SECRET;
});

describe("/api/geocode con localidad", () => {
  it("consulta estructurada con la altura al frente", async () => {
    fetchMock.mockResolvedValueOnce(respuesta([colon]));
    await get("text=Av.%20Col%C3%B3n%202500&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires");
    const u = urls()[0];
    expect(u.searchParams.get("street")).toBe("2500 av. colón");
    expect(u.searchParams.get("city")).toBe("mar del plata");
    expect(u.searchParams.get("state")).toBe("buenos aires");
    expect(u.searchParams.get("countrycodes")).toBe("ar");
  });

  it("devuelve lat, lon, precisión, barrio y un geoToken verificable", async () => {
    fetchMock.mockResolvedValueOnce(respuesta([colon]));
    const res = await get("text=Av.%20Col%C3%B3n%202500&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires");
    const [s] = await res.json();
    expect(s).toMatchObject({ calle: "Avenida Colón 2500", lat: -37.99, lon: -57.55, precision: "altura", barrio: "Centro" });
    expect(verificarGeo(s.geoToken, { calle: "avenida colon 2500" })).toMatchObject({ lat: -37.99, precision: "altura", cp: "7600" });
  });

  it("sin número de casa la precisión es calle", async () => {
    fetchMock.mockResolvedValueOnce(respuesta([sinAltura]));
    const [s] = await (await get("text=Avenida%20Colon&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires")).json();
    expect(s.precision).toBe("calle");
  });

  it("0 resultados: UN reintento en texto libre acotado", async () => {
    fetchMock.mockResolvedValueOnce(respuesta([])).mockResolvedValueOnce(respuesta([colon]));
    const res = await get("text=Av.%20Col%C3%B3n%202500&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urls()[1].searchParams.get("q")).toBe("av. colón 2500, mar del plata, buenos aires");
    expect(await res.json()).toHaveLength(1);
  });

  it("sigue vacío: [] sin caer a una búsqueda nacional", async () => {
    fetchMock.mockImplementation(async () => respuesta([]));
    const res = await get("text=Calle%20Inexistente%201&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urls().every((u) => u.searchParams.get("city") === "mar del plata" || (u.searchParams.get("q") ?? "").includes("mar del plata"))).toBe(true);
    expect(await res.json()).toEqual([]);
  });

  it("el reintento sólo sale si el primero fue vacío", async () => {
    fetchMock.mockResolvedValueOnce(respuesta([colon]));
    await get("text=Av.%20Col%C3%B3n%202500&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin secreto de firma no hay token pero sí coordenadas", async () => {
    delete process.env.GEOCODE_FIRMA_SECRET;
    fetchMock.mockResolvedValueOnce(respuesta([colon]));
    const [s] = await (await get("text=Av.%20Col%C3%B3n%202500&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires")).json();
    expect(s.lat).toBe(-37.99);
    expect(s.geoToken).toBeUndefined();
  });
});

describe("/api/geocode sin localidad o con el flag apagado", () => {
  it("sin ciudad: consulta libre de siempre", async () => {
    fetchMock.mockResolvedValueOnce(respuesta([colon]));
    await get("text=San%20Mart%C3%ADn%20100");
    const u = urls()[0];
    expect(u.searchParams.get("q")).toBe("san martín 100");
    expect(u.searchParams.get("street")).toBeNull();
  });

  it("flag apagado: ignora ciudad/provincia y no suma lat/lon/token", async () => {
    flag = false;
    fetchMock.mockResolvedValueOnce(respuesta([colon]));
    const res = await get("text=Av.%20Col%C3%B3n%202500&ciudad=Mar%20del%20Plata&provincia=Buenos%20Aires");
    expect(urls()[0].searchParams.get("street")).toBeNull();
    expect(urls()[0].searchParams.get("q")).toBe("av. colón 2500");
    const [s] = await res.json();
    expect(Object.keys(s).sort()).toEqual(["calle", "ciudad", "cp", "label", "provincia"]);
  });
});
