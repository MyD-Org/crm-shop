import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { metodoDePrueba, puntoDePrueba } from "@/test/envio-metodo";
import { firmarGeo } from "@/lib/geo-token";

/**
 * Envío por zona en `/api/carrito/cotizar` (change `envio-por-zona-con-tarifa`): el costo sale del
 * método del CRM por la dirección, entra al total por `costoEnvioPara` y las coordenadas sólo valen si
 * son verificadas. Con el flag apagado la respuesta es la de siempre.
 */

let identidad: { clerkUserId: string | null; cliente: { codigocliente: string } | null };
const cotizar = vi.fn();
const leerConfigEnvio = vi.fn();
const direccionParaEnvio = vi.fn();

vi.mock("@/lib/auth", () => ({ identidadActual: async () => identidad }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => null }));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: (...a: unknown[]) => leerConfigEnvio(...a),
}));
vi.mock("@/lib/direcciones-envio-db", () => ({ direccionParaEnvio: (...a: unknown[]) => direccionParaEnvio(...a) }));

import { POST } from "./route";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";

const SECRETO = "s3cr3t-placeholder-para-tests-cotizar-0123456789";
const CENTRO = puntoDePrueba("centro");

let n = 0;
const pedir = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${(n = (n % 200) + 1)}` },
      body: JSON.stringify({ items: [{ id: "1", qty: 2 }], entregaTipo: "envio", provincia: "Buenos Aires", ...extra }),
    }),
  );

const token = () =>
  firmarGeo({
    lat: CENTRO.lat,
    lon: CENTRO.lon,
    calle: "Calle Ejemplo 123",
    ciudad: "Ciudad Ejemplo",
    provincia: "Buenos Aires",
    cp: "7600",
    precision: "altura",
  });

beforeEach(() => {
  vi.stubEnv("GEOCODE_FIRMA_SECRET", SECRETO);
  identidad = { clerkUserId: null, cliente: null };
  cotizar.mockReset();
  // Imita a `cotizar`: subtotal 1000 + IVA 210 y el costo de `costoEnvioPara`.
  cotizar.mockImplementation(async (_l: unknown, o: { costoEnvioPara?: (s: number) => number }) => {
    const costoEnvio = o.costoEnvioPara ? o.costoEnvioPara(1000) : 0;
    return { lineas: [], subtotal: 1000, iva: 210, costoEnvio, total: 1210 + costoEnvio, hayProblemas: false, flujo: "normal" };
  });
  leerConfigEnvio.mockReset();
  leerConfigEnvio.mockImplementation(async (_db: unknown, opts?: { conMetodos?: boolean }) => ({
    ...CONFIG_ENVIO_DEFAULT,
    ...(opts?.conMetodos ? { metodos: [metodoDePrueba()] } : {}),
  }));
  direccionParaEnvio.mockReset();
  direccionParaEnvio.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/carrito/cotizar — envío por zona", () => {
  it("flag APAGADO: no pide los métodos, no suma envío y la respuesta es la de siempre", async () => {
    const r = await (await pedir({ destino: { geoToken: token(), calle: "Calle Ejemplo 123" } })).json();
    expect(leerConfigEnvio).toHaveBeenCalledWith(undefined, { conMetodos: false });
    expect(r.costoEnvio).toBe(0);
    expect(r.total).toBe(1210);
    expect(r.envio).toEqual({ disponible: true, gratis: false, aCoordinar: true, motivo: "gratis_apagado", faltante: 0 });
    expect((cotizar.mock.calls[0][1] as object)).not.toHaveProperty("costoEnvioPara");
  });

  describe("flag prendido", () => {
    beforeEach(() => setFlag("envio-por-zona", true));

    it("con un geoToken válido: el costo de la zona entra al total y el envío trae el método", async () => {
      const r = await (await pedir({ destino: { geoToken: token(), calle: "Calle Ejemplo 123" } })).json();
      expect(leerConfigEnvio).toHaveBeenCalledWith(undefined, { conMetodos: true });
      expect(r.costoEnvio).toBe(3000);
      expect(r.total).toBe(4210);
      expect(r.envio).toMatchObject({ disponible: true, aCoordinar: false, costo: 3000 });
      expect(r.envio.metodo).toMatchObject({ zona: "Centro", regla: "poligono", precision: "altura" });
    });

    it("lat/lon crudos en el body se IGNORAN (no hay ubicación verificada: a coordinar)", async () => {
      const r = await (await pedir({ destino: { lat: CENTRO.lat, lon: CENTRO.lon, calle: "Calle Ejemplo 123" }, lat: CENTRO.lat, lon: CENTRO.lon })).json();
      expect(r.costoEnvio).toBe(0);
      expect(r.envio.metodo).toBeUndefined();
    });

    it("token falsificado, vencido o de otra calle: sin punto", async () => {
      const falso = token().replace(/.$/, (c) => (c === "A" ? "B" : "A"));
      expect((await (await pedir({ destino: { geoToken: falso, calle: "Calle Ejemplo 123" } })).json()).costoEnvio).toBe(0);
      expect((await (await pedir({ destino: { geoToken: token(), calle: "Otra Calle 9" } })).json()).costoEnvio).toBe(0);
    });

    it("direccionId de una dirección guardada del usuario: lat/lon salen de la base", async () => {
      identidad = { clerkUserId: "user_ejemplo", cliente: null };
      direccionParaEnvio.mockResolvedValue({ calle: "Calle 1 100", ciudad: "Ciudad", provincia: "Buenos Aires", cp: null, lat: CENTRO.lat, lon: CENTRO.lon });
      const r = await (await pedir({ destino: { direccionId: "123e4567-e89b-12d3-a456-426614174000" } })).json();
      expect(direccionParaEnvio).toHaveBeenCalledWith("user_ejemplo", "123e4567-e89b-12d3-a456-426614174000");
      expect(r.costoEnvio).toBe(3000);
    });

    it("por CP sin coordenadas: aplica la zona con regla cp", async () => {
      const r = await (await pedir({ destino: { cp: "7600" } })).json();
      expect(r.envio.metodo).toMatchObject({ zona: "Centro", regla: "cp" });
      expect(r.costoEnvio).toBe(3000);
    });

    it("localidad atendida sin ubicación exacta: a coordinar y avisa sinUbicar (no inventa precio)", async () => {
      const r = await (await pedir({ destino: { georefId: "9990010" } })).json();
      expect(r.costoEnvio).toBe(0);
      expect(r.envio).toMatchObject({ aCoordinar: true, sinUbicar: true });
    });

    it("retiro: nunca suma envío ni lee la dirección", async () => {
      const r = await (await pedir({ entregaTipo: "retiro", destino: { geoToken: token(), calle: "Calle Ejemplo 123" } })).json();
      expect(r.costoEnvio).toBe(0);
      expect(direccionParaEnvio).not.toHaveBeenCalled();
    });

    it("sin métodos cargados (o tablas sin migrar): como siempre", async () => {
      leerConfigEnvio.mockResolvedValue({ ...CONFIG_ENVIO_DEFAULT, metodos: [] });
      const r = await (await pedir({ destino: { geoToken: token(), calle: "Calle Ejemplo 123" } })).json();
      expect(r.costoEnvio).toBe(0);
      expect(r.envio.metodo).toBeUndefined();
    });

    it("el costo viaja a TODAS las cotizaciones por opcionesCotizar (un solo punto de entrada)", async () => {
      await pedir({ destino: { geoToken: token(), calle: "Calle Ejemplo 123" } });
      for (const [, o] of cotizar.mock.calls) {
        expect(typeof (o as { costoEnvioPara?: unknown }).costoEnvioPara).toBe("function");
      }
    });

    it("rama de 0 líneas: la misma forma de siempre", async () => {
      const r = await (
        await POST(
          new Request("https://tienda.example/api/carrito/cotizar", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.250" },
            body: JSON.stringify({ items: [], entregaTipo: "envio", provincia: "Buenos Aires" }),
          }),
        )
      ).json();
      expect(r).toMatchObject({ total: 0, costoEnvio: 0 });
    });
  });
});
