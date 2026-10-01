import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "@/lib/__fixtures__/georef-respuestas.json";
import { claveProvincia } from "@/lib/sucursales";
import { COOKIE_UBICACION, validarCookieUbicacion } from "@/lib/ubicacion";
import { POST as coordenadas } from "./coordenadas/route";
import { GET as localidades } from "./localidades/route";
import { DELETE, POST as elegir } from "./route";

const fetchMock = vi.fn();
let ip = 0;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  ip += 1; // cada test con su IP: el rate limit vive en memoria
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const georefOk = (cuerpo: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify(cuerpo), { status: 200 }));
const georefCaido = () => fetchMock.mockResolvedValue(new Response("boom", { status: 503 }));

const pedido = (url: string, init?: { method?: string; body?: unknown }) =>
  new Request(`https://tienda.example${url}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${ip}` },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

function cookieGuardada(res: Response) {
  const set = res.headers.get("set-cookie") ?? "";
  const m = set.match(new RegExp(`${COOKIE_UBICACION}=([^;]*)`));
  return { set, valor: m ? validarCookieUbicacion(decodeURIComponent(m[1])) : null };
}

describe("POST /api/ubicacion/coordenadas", () => {
  it("coordenadas válidas: guarda la cookie HttpOnly y no devuelve las coordenadas", async () => {
    georefOk(fixtures.ubicacion);
    const res = await coordenadas(pedido("/api/ubicacion/coordenadas", { method: "POST", body: { lat: -25.6, lon: -54.57 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ localidad: "Puerto Iguazú", provincia: claveProvincia("Misiones") });
    const { set, valor } = cookieGuardada(res);
    expect(valor).toEqual({ localidad: "Puerto Iguazú", provincia: claveProvincia("Misiones") });
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=lax/i);
    expect(set).toMatch(/Max-Age=31536000/);
    expect(set).not.toContain("-25.6");
  });

  it("fuera de rango o no numéricas: 400 sin llamar a Georef", async () => {
    for (const body of [{ lat: 40, lon: -3 }, { lat: "a", lon: "b" }, {}, null]) {
      const res = await coordenadas(pedido("/api/ubicacion/coordenadas", { method: "POST", body }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Ubicación inválida." });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Georef sin provincia: 404 con mensaje en usted y sin cookie", async () => {
    georefOk({ ubicacion: { provincia: { nombre: null }, departamento: { nombre: null }, municipio: { nombre: null } } });
    const res = await coordenadas(pedido("/api/ubicacion/coordenadas", { method: "POST", body: { lat: -30, lon: -60 } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("No pudimos determinar su ubicación. Ingrese su localidad.");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("Georef caído: 502 con mensaje y sin cookie", async () => {
    georefCaido();
    const res = await coordenadas(pedido("/api/ubicacion/coordenadas", { method: "POST", body: { lat: -25.6, lon: -54.57 } }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("No pudimos determinar su ubicación. Ingrese su localidad.");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("no loguea las coordenadas cuando Georef falla", async () => {
    georefCaido();
    await coordenadas(pedido("/api/ubicacion/coordenadas", { method: "POST", body: { lat: -25.612345, lon: -54.571234 } }));
    const log = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(log).not.toContain("25.612345");
    expect(log).not.toContain("54.571234");
  });

  it("rate limit por IP", async () => {
    georefOk(fixtures.ubicacion);
    let ultimo = 200;
    for (let i = 0; i < 12; i++) {
      ultimo = (await coordenadas(pedido("/api/ubicacion/coordenadas", { method: "POST", body: { lat: -25.6, lon: -54.57 } }))).status;
    }
    expect(ultimo).toBe(429);
  });
});

describe("GET /api/ubicacion/localidades", () => {
  it("devuelve 'Localidad — Provincia' con id", async () => {
    georefOk(fixtures.localidades);
    const res = await localidades(pedido("/api/ubicacion/localidades?q=coronel%20vid"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ localidades: [{ id: "06518010", etiqueta: "Coronel Vidal — Buenos Aires" }] });
  });

  it("consulta corta: lista vacía sin llamar a Georef", async () => {
    const res = await localidades(pedido("/api/ubicacion/localidades?q=pos"));
    expect(await res.json()).toEqual({ localidades: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consulta desmesurada: 400", async () => {
    const res = await localidades(pedido(`/api/ubicacion/localidades?q=${"a".repeat(200)}`));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Georef caído: 502 con el mensaje de búsqueda", async () => {
    georefCaido();
    const res = await localidades(pedido("/api/ubicacion/localidades?q=coronel"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("No pudimos buscar localidades en este momento. Inténtelo nuevamente.");
  });

  it("rate limit por IP", async () => {
    georefOk(fixtures.localidades);
    let ultimo = 200;
    for (let i = 0; i < 32; i++) ultimo = (await localidades(pedido("/api/ubicacion/localidades?q=coronel"))).status;
    expect(ultimo).toBe(429);
  });
});

describe("POST /api/ubicacion (elegir una localidad)", () => {
  it("re-resuelve por id en Georef y guarda la cookie con la provincia del servidor", async () => {
    georefOk(fixtures.localidades);
    // El cliente intenta colar otra provincia: se ignora.
    const res = await elegir(pedido("/api/ubicacion", { method: "POST", body: { id: "06518010", provincia: "misiones" } }));
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).toEqual({
      localidad: "Coronel Vidal",
      provincia: claveProvincia("Buenos Aires"),
      id: "06518010",
    });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("id")).toBe("06518010");
  });

  it("id inválido: 400 sin llamar a Georef", async () => {
    const res = await elegir(pedido("/api/ubicacion", { method: "POST", body: { id: "../etc" } }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("id inexistente: 404", async () => {
    georefOk({ localidades: [] });
    const res = await elegir(pedido("/api/ubicacion", { method: "POST", body: { id: "999" } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("No encontramos esa localidad");
  });

  it("Georef caído: 502 y sin cookie", async () => {
    georefCaido();
    const res = await elegir(pedido("/api/ubicacion", { method: "POST", body: { id: "06518010" } }));
    expect(res.status).toBe(502);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("DELETE /api/ubicacion", () => {
  it("borra la cookie", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${COOKIE_UBICACION}=;`));
  });
});
