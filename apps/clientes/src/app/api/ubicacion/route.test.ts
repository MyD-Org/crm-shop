import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "@/lib/__fixtures__/georef-respuestas.json";
import { claveProvincia } from "@/lib/sucursales";
import { COOKIE_UBICACION, validarCookieUbicacion } from "@/lib/ubicacion";
import { estadoFlags } from "@/test/flags";

let userId: string | null = null;
let direcciones: Record<string, unknown>[] = [];
let sucursales: Record<string, unknown>[] = [];
const listarDirecciones = vi.fn<(...a: unknown[]) => Promise<typeof direcciones>>(async () => direcciones);

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId }) }));
vi.mock("@/lib/direcciones-envio-db", () => ({ listarDirecciones: (...a: unknown[]) => listarDirecciones(...a) }));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: async () => ({ sucursales, zonas: [] }) }));

import { POST as coordenadas } from "./coordenadas/route";
import { GET as localidades } from "./localidades/route";
import { DELETE, POST as elegir } from "./route";

const fetchMock = vi.fn();
let ip = 0;

const DIR_ID = "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10";
const AJENA = "2dafaf30-9e77-4c5a-9f20-4e3f9f8d1c32";
const guardada = {
  id: DIR_ID,
  etiqueta: "Casa",
  calle: "Av. Victoria Aguirre 100",
  ciudad: "Puerto Iguazú",
  provincia: "Misiones",
  cp: "3370",
  referencias: null,
  predeterminada: true,
};
const sucursal = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: `Local ${slug}`,
  ciudad: "Ciudad Ejemplo",
  provincia: "Córdoba",
  direccion: "Calle 1",
  horario: "",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 0,
  activa: true,
  predeterminada: false,
  ...extra,
});

beforeEach(() => {
  userId = null;
  direcciones = [guardada];
  sucursales = [sucursal("sucursal-a"), sucursal("sucursal-b")];
  estadoFlags().sucursales = true;
  listarDirecciones.mockClear();
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
    expect(await res.json()).toEqual({ tipo: "envio", localidad: "Puerto Iguazú", provincia: claveProvincia("Misiones") });
    const { set, valor } = cookieGuardada(res);
    expect(valor).toEqual({ tipo: "envio", localidad: "Puerto Iguazú", provincia: claveProvincia("Misiones") });
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
    const res = await elegir(pedido("/api/ubicacion", { method: "POST", body: { id: "06518010", cp: "6500", provincia: "misiones" } }));
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).toEqual({
      tipo: "envio",
      localidad: "Coronel Vidal",
      provincia: claveProvincia("Buenos Aires"),
      id: "06518010",
      cp: "6500",
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
    const res = await elegir(pedido("/api/ubicacion", { method: "POST", body: { id: "999", cp: "6500" } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("No encontramos esa localidad");
  });

  it("Georef caído: 502 y sin cookie", async () => {
    georefCaido();
    const res = await elegir(pedido("/api/ubicacion", { method: "POST", body: { id: "06518010", cp: "6500" } }));
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

const post = (body: unknown) => elegir(pedido("/api/ubicacion", { method: "POST", body }));
const sinCookie = (res: Response) => expect(res.headers.get("set-cookie")).toBeNull();

describe("POST /api/ubicacion: {id, cp}", () => {
  it("normaliza el cp (CPA en minúsculas) y lo guarda", async () => {
    georefOk(fixtures.localidades);
    const res = await post({ id: "06518010", cp: "c1425abc" });
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).toMatchObject({ tipo: "envio", cp: "C1425ABC" });
    expect(await res.json()).toMatchObject({ tipo: "envio", localidad: "Coronel Vidal" });
  });

  it("cp inválido: 400 en usted, sin Georef y sin tocar la cookie", async () => {
    for (const cp of ["12", "ABCDE", "50000", ""]) {
      const res = await post({ id: "06518010", cp });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "Ingrese un código postal válido: 4 dígitos o formato CPA, por ejemplo 5000 o C1425ABC.",
      );
      sinCookie(res);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cp ausente sin sesión: ok (el Shop ya no pide el código postal)", async () => {
    georefOk(fixtures.localidades);
    const res = await post({ id: "06518010" });
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).not.toHaveProperty("cp");
  });

  it("cp ausente con sesión: ok", async () => {
    userId = "user_1";
    georefOk(fixtures.localidades);
    const res = await post({ id: "06518010" });
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).not.toHaveProperty("cp");
  });
});

describe("POST /api/ubicacion: {direccionId}", () => {
  it("dirección propia: cookie de envío con id y snapshot", async () => {
    userId = "user_1";
    const res = await post({ direccionId: DIR_ID });
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).toEqual({
      tipo: "envio",
      localidad: "Puerto Iguazú",
      provincia: claveProvincia("Misiones"),
      cp: "3370",
      direccionId: DIR_ID,
    });
    expect(await res.json()).toEqual({ tipo: "envio", localidad: "Puerto Iguazú", provincia: claveProvincia("Misiones") });
    expect(listarDirecciones).toHaveBeenCalledWith("user_1");
  });

  it("sin sesión: 401 sin cookie", async () => {
    const res = await post({ direccionId: DIR_ID });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Inicie sesión para elegir una dirección guardada.");
    sinCookie(res);
    expect(listarDirecciones).not.toHaveBeenCalled();
  });

  it("ajena o inexistente: 404 sin datos y sin cookie", async () => {
    userId = "user_1";
    const res = await post({ direccionId: AJENA });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("Iguazú");
    sinCookie(res);
  });

  it("id con forma inválida: 400", async () => {
    userId = "user_1";
    const res = await post({ direccionId: "1; drop table" });
    expect(res.status).toBe(400);
    sinCookie(res);
  });
});

describe("POST /api/ubicacion: {tipo: retiro}", () => {
  it("sucursal válida: cookie de retiro sin residuales", async () => {
    const res = await post({ tipo: "retiro", sucursal: "sucursal-a" });
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).toEqual({ tipo: "retiro", sucursal: "sucursal-a" });
    expect(await res.json()).toEqual({ tipo: "retiro", sucursal: "sucursal-a" });
  });

  it("sucursal inexistente, inactiva o sin retiro: error y sin cookie", async () => {
    sucursales = [sucursal("sucursal-a", { activa: false }), sucursal("sucursal-b", { aceptaRetiro: false })];
    for (const s of ["sucursal-a", "sucursal-b", "no-existe"]) {
      const res = await post({ tipo: "retiro", sucursal: s });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("No encontramos ese local de retiro.");
      sinCookie(res);
    }
  });

  it("slug basura: 400", async () => {
    const res = await post({ tipo: "retiro", sucursal: "../x" });
    expect(res.status).toBe(400);
    sinCookie(res);
  });

  it("flag sucursales encendido sin sucursal: 400", async () => {
    const res = await post({ tipo: "retiro" });
    expect(res.status).toBe(400);
    sinCookie(res);
  });

  it("flag apagado: acepta sólo sin sucursal", async () => {
    estadoFlags().sucursales = false;
    const ok = await post({ tipo: "retiro" });
    expect(ok.status).toBe(200);
    expect(cookieGuardada(ok).valor).toEqual({ tipo: "retiro" });
    const mal = await post({ tipo: "retiro", sucursal: "sucursal-a" });
    expect(mal.status).toBe(400);
    sinCookie(mal);
  });
});

describe("POST /api/ubicacion: payloads", () => {
  it("mixtos o inválidos: 400 sin cookie", async () => {
    userId = "user_1";
    for (const body of [
      { id: "06518010", direccionId: DIR_ID },
      { tipo: "retiro", sucursal: "sucursal-a", direccionId: DIR_ID },
      { tipo: "retiro", id: "06518010", cp: "5000" },
      { tipo: "paloma" },
      {},
      null,
      "texto",
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      sinCookie(res);
    }
  });

  it("cambiar de retiro a envío reemplaza la cookie por completo", async () => {
    georefOk(fixtures.localidades);
    const res = await post({ id: "06518010", cp: "6500" });
    const { valor } = cookieGuardada(res);
    expect(valor).not.toHaveProperty("sucursal");
    expect(valor?.tipo).toBe("envio");
  });

  it("rate limit existente", async () => {
    let ultimo = 200;
    for (let i = 0; i < 22; i++) ultimo = (await post({ tipo: "retiro", sucursal: "sucursal-a" })).status;
    expect(ultimo).toBe(429);
  });
});

describe("GET /api/ubicacion/opciones", () => {
  it("lista los locales con retiro activos; unico=false", async () => {
    const { GET } = await import("./opciones/route");
    sucursales = [
      sucursal("sucursal-b", { orden: 2, horario: "Lunes a viernes de 9 a 18" }),
      sucursal("sucursal-a", { orden: 1 }),
      sucursal("inactiva", { activa: false }),
      sucursal("sin-retiro", { aceptaRetiro: false }),
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      locales: [
        { slug: "sucursal-a", nombre: "Local sucursal-a", direccion: "Calle 1", horario: "" },
        { slug: "sucursal-b", nombre: "Local sucursal-b", direccion: "Calle 1", horario: "Lunes a viernes de 9 a 18" },
      ],
      unico: false,
    });
    expect(res.headers.get("cache-control")).toMatch(/max-age/);
  });

  it("flag sucursales apagado: sin locales y unico=true", async () => {
    const { GET } = await import("./opciones/route");
    estadoFlags().sucursales = false;
    const res = await GET();
    expect(await res.json()).toEqual({ locales: [], unico: true });
  });
});

describe("POST /api/ubicacion/coordenadas: no regresión", () => {
  it("la localidad queda sin cp", async () => {
    georefOk(fixtures.ubicacion);
    const res = await coordenadas(pedido("/api/ubicacion/coordenadas", { method: "POST", body: { lat: -25.6, lon: -54.57 } }));
    expect(res.status).toBe(200);
    expect(cookieGuardada(res).valor).not.toHaveProperty("cp");
  });
});
