import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_UBICACION, validarCookieUbicacion } from "@/lib/ubicacion";
import { verificarGeo } from "@/lib/geo-token";
import { estadoFlags } from "@/test/flags";
import { PUNTOS, metodoDePrueba } from "@/test/envio-metodo";

/**
 * «Usar mi ubicación» con el envío por zona: reverse geocoding (Nominatim), cookie sin coordenadas sueltas,
 * techo global y respaldo cuando algo falla. Con el flag apagado, todo igual que antes.
 */
const SECRETO = "s3cr3t-placeholder-para-tests-pedidos-0123456789";

vi.mock("@/lib/marca", () => ({ getMarca: async () => ({}) }));
vi.mock("@/lib/marca-base", () => ({ idTecnico: () => "shop" }));
vi.mock("@/lib/sucursales-repo", () => ({
  leerConfigEnvio: async () => ({ domicilioActivo: true, gratis: null, metodos: [metodoDePrueba()] }),
}));
const permitirAsync = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: (...a: unknown[]) => permitirAsync(...a) }));

import { POST } from "./route";

const fetchMock = vi.fn();
let ip = 0;
const { lat, lon } = PUNTOS.centro;

const georefBsAs = {
  ubicacion: { provincia: { nombre: "Buenos Aires" }, departamento: { nombre: "General Pueyrredón" }, municipio: { nombre: "General Pueyrredón" } },
};
const nominatim = (address: Record<string, string>) => ({ address });

/** Georef y Nominatim por URL. `reverse` = respuesta de Nominatim (o un Response de error / un throw). */
function red(reverse: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("nominatim.openstreetmap.org/reverse")) {
      if (reverse instanceof Error) throw reverse;
      return reverse instanceof Response ? reverse : new Response(JSON.stringify(reverse), { status: 200 });
    }
    return new Response(JSON.stringify(georefBsAs), { status: 200 });
  });
}

const llamar = () =>
  POST(
    new Request("https://tienda.example/api/ubicacion/coordenadas", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${ip}` },
      body: JSON.stringify({ lat, lon }),
    }),
  );

function cookie(res: Response) {
  const m = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${COOKIE_UBICACION}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

const llamadasReverse = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/reverse"));

beforeEach(() => {
  ip += 1;
  permitirAsync.mockClear();
  permitirAsync.mockResolvedValue(true);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEOCODE_FIRMA_SECRET", SECRETO);
  vi.stubEnv("GEOCODE_CONTACT_EMAIL", "contacto@cliente.example");
  vi.spyOn(console, "error").mockImplementation(() => {});
  estadoFlags()["envio-por-zona"] = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ubicacion/coordenadas con envío por zona", () => {
  it("con calle y altura: guarda calle, CP, zona y geoToken; sin lat/lon sueltos", async () => {
    red(nominatim({ road: "Avenida Colón", house_number: "2500", city: "Mar del Plata", state: "Provincia de Buenos Aires", postcode: "7600" }));
    const res = await llamar();
    expect(res.status).toBe(200);
    const crudo = cookie(res);
    const c = validarCookieUbicacion(crudo);
    expect(c).toMatchObject({ tipo: "envio", provincia: "buenosaires", calle: "Avenida Colón 2500", cp: "7600", zona: "Centro" });
    expect(Object.keys(JSON.parse(crudo)).sort()).toEqual(["calle", "cp", "geoToken", "localidad", "provincia", "tipo", "zona"].sort());
    // Ni lat/lon sueltos en la cookie ni en el cuerpo.
    expect(crudo).not.toContain(String(lat));
    expect(crudo).not.toContain(String(lon));
    expect(JSON.stringify(await res.json())).not.toContain(String(lat));
    // Las coordenadas viajan sólo dentro del token, firmado con esa calle.
    const g = verificarGeo(JSON.parse(crudo).geoToken, { calle: "Avenida Colón 2500" });
    expect(g).toMatchObject({ lat, lon, precision: "altura", cp: "7600" });
  });

  it("consulta Nominatim /reverse con el User-Agent identificable y sin caché", async () => {
    red(nominatim({ road: "Avenida Colón", house_number: "2500" }));
    await llamar();
    const [url, init] = llamadasReverse()[0] as [string, RequestInit];
    expect(url).toContain("format=jsonv2");
    expect(url).toContain("addressdetails=1");
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("contacto@cliente.example");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("calle sin altura: igual firma el token, con precisión «calle»", async () => {
    red(nominatim({ road: "Avenida Colón" }));
    const crudo = cookie(await llamar());
    const g = verificarGeo(JSON.parse(crudo).geoToken, { calle: "Avenida Colón" });
    expect(g?.precision).toBe("calle");
  });

  it("sin calle en la respuesta: queda la localidad atendida de siempre, sin token", async () => {
    red(nominatim({ city: "Mar del Plata" }));
    const res = await llamar();
    expect(res.status).toBe(200);
    const c = validarCookieUbicacion(cookie(res));
    expect(c).toMatchObject({ tipo: "envio", provincia: "buenosaires" });
    expect(c).not.toHaveProperty("calle");
    expect(c).not.toHaveProperty("geoToken");
  });

  it.each([
    ["error 500", new Response("boom", { status: 500 })],
    ["timeout o sin red", new Error("timeout")],
  ])("Nominatim falla (%s): nada se rompe y no se loguean coordenadas", async (_n, falla) => {
    red(falla);
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(validarCookieUbicacion(cookie(res))).not.toHaveProperty("geoToken");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(String(lat));
  });

  it("sin GEOCODE_FIRMA_SECRET no hay token ni se llama a Nominatim", async () => {
    vi.stubEnv("GEOCODE_FIRMA_SECRET", "");
    red(nominatim({ road: "Avenida Colón", house_number: "2500" }));
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(llamadasReverse()).toHaveLength(0);
    expect(validarCookieUbicacion(cookie(res))).not.toHaveProperty("geoToken");
  });

  it("techo global de reverse: superado, sigue con la localidad sin llamar a Nominatim", async () => {
    permitirAsync.mockImplementation(async (clave) => clave !== "ubicacion-reverse:global");
    red(nominatim({ road: "Avenida Colón", house_number: "2500" }));
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(llamadasReverse()).toHaveLength(0);
    expect(validarCookieUbicacion(cookie(res))).not.toHaveProperty("geoToken");
    expect(permitirAsync).toHaveBeenCalledWith("ubicacion-reverse:global", expect.any(Number), 60_000);
  });

  it("punto fuera de toda zona: guarda calle y token pero sin zona", async () => {
    // Fuera de los polígonos y de la localidad: ningún método lo resuelve.
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/reverse")
        ? new Response(JSON.stringify(nominatim({ road: "Calle Lejana", house_number: "10" })), { status: 200 })
        : new Response(JSON.stringify(georefBsAs), { status: 200 }),
    );
    const res = await POST(
      new Request("https://tienda.example/api/ubicacion/coordenadas", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${ip}` },
        body: JSON.stringify(PUNTOS.afuera),
      }),
    );
    const c = validarCookieUbicacion(cookie(res));
    expect(c).toMatchObject({ calle: "Calle Lejana 10" });
    expect(c).not.toHaveProperty("zona");
  });
});

describe("POST /api/ubicacion/coordenadas con el flag apagado", () => {
  it("igual que hoy: sin reverse, sin token, cookie sólo con localidad y provincia", async () => {
    estadoFlags()["envio-por-zona"] = false;
    red(nominatim({ road: "Avenida Colón", house_number: "2500" }));
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(llamadasReverse()).toHaveLength(0);
    expect(validarCookieUbicacion(cookie(res))).toEqual({ tipo: "envio", localidad: "General Pueyrredón", provincia: "buenosaires" });
  });
});
