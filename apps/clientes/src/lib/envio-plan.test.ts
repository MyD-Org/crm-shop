import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firmarGeo } from "./geo-token";
import {
  leerDestinoBody,
  origenDeEnvio,
  planEnvio,
  resolverDestinoEnvio,
  type DireccionGuardada,
} from "./envio-plan";
import { CONFIG_ENVIO_DEFAULT, type ConfigEnvio } from "./envio";
import { metodoDePrueba, puntoDePrueba } from "@/test/envio-metodo";

const SECRETO = "s3cr3t-placeholder-para-tests-plan-0123456789";
let previo: string | undefined;
beforeEach(() => {
  previo = process.env.GEOCODE_FIRMA_SECRET;
  process.env.GEOCODE_FIRMA_SECRET = SECRETO;
});
afterEach(() => {
  if (previo === undefined) delete process.env.GEOCODE_FIRMA_SECRET;
  else process.env.GEOCODE_FIRMA_SECRET = previo;
});

const CENTRO = puntoDePrueba("centro");
const tokenCentro = (extra: Partial<Parameters<typeof firmarGeo>[0]> = {}) =>
  firmarGeo({
    lat: CENTRO.lat,
    lon: CENTRO.lon,
    calle: "Calle Ejemplo 123",
    ciudad: "Ciudad Ejemplo",
    provincia: "Buenos Aires",
    cp: "7600",
    precision: "altura",
    ...extra,
  });

describe("leerDestinoBody", () => {
  it("acota strings y descarta lo que no es texto; ignora lat/lon crudos", () => {
    const d = leerDestinoBody({
      direccionId: "no-es-uuid",
      geoToken: "x".repeat(2000),
      calle: " Calle 1 ",
      localidad: "L".repeat(500),
      cp: 7600,
      lat: -38,
      lon: -57,
    });
    expect(d.direccionId).toBeUndefined();
    expect(d.geoToken).toBeUndefined();
    expect(d.calle).toBe("Calle 1");
    expect(d.localidad).toHaveLength(80);
    expect(d.cp).toBeUndefined();
    expect(d).not.toHaveProperty("lat");
  });

  it("body que no es un objeto: vacío", () => {
    expect(leerDestinoBody(null)).toEqual({});
    expect(leerDestinoBody("x")).toEqual({});
  });

  it("acepta un uuid de dirección y un georefId numérico", () => {
    const d = leerDestinoBody({ direccionId: "123e4567-e89b-12d3-a456-426614174000", georefId: "9990010" });
    expect(d.direccionId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(d.georefId).toBe("9990010");
  });
});

describe("resolverDestinoEnvio", () => {
  const sinDirecciones = async () => null;

  it("geoToken válido con la calle firmada: punto verificado, con ciudad y CP firmados", async () => {
    const d = await resolverDestinoEnvio({
      destino: { geoToken: tokenCentro(), calle: "Calle Ejemplo 123", cp: "9999", localidad: "Otra" },
      provincia: "Buenos Aires",
      clerkUserId: null,
      leerDireccion: sinDirecciones,
    });
    expect(d.punto).toEqual({ lat: CENTRO.lat, lon: CENTRO.lon, precision: "altura" });
    expect(d.provinciaClave).toBe("buenosaires");
    // Con ubicación verificada, ciudad y CP son los FIRMADOS, no los del body.
    expect(d.cp).toBe("7600");
    expect(d.localidad).toBe("Ciudad Ejemplo");
  });

  it("geoToken con otra calle: sin punto (usa el CP y la localidad del body)", async () => {
    const d = await resolverDestinoEnvio({
      destino: { geoToken: tokenCentro(), calle: "Otra Calle 9", cp: "7601", localidad: "Ciudad X" },
      provincia: "Buenos Aires",
      clerkUserId: null,
      leerDireccion: sinDirecciones,
    });
    expect(d.punto).toBeNull();
    expect(d.cp).toBe("7601");
    expect(d.localidad).toBe("Ciudad X");
  });

  it("token falsificado o vencido: sin punto", async () => {
    const falso = tokenCentro().replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const d = await resolverDestinoEnvio({
      destino: { geoToken: falso, calle: "Calle Ejemplo 123" },
      provincia: "Buenos Aires",
      clerkUserId: null,
      leerDireccion: sinDirecciones,
    });
    expect(d.punto).toBeNull();
  });

  it("direccionId: lat/lon salen de la base (el body no manda) y la dirección guardada manda sobre el texto", async () => {
    const guardada: DireccionGuardada = { calle: "Calle Guardada 5", ciudad: "Ciudad Guardada", provincia: "Buenos Aires", cp: "7600", lat: CENTRO.lat, lon: CENTRO.lon };
    const pedidas: string[] = [];
    const d = await resolverDestinoEnvio({
      destino: { direccionId: "123e4567-e89b-12d3-a456-426614174000", cp: "0000", localidad: "Mentira" },
      provincia: "Buenos Aires",
      clerkUserId: "user_ejemplo",
      leerDireccion: async (u, id) => (pedidas.push(`${u}:${id}`), guardada),
    });
    expect(pedidas).toEqual(["user_ejemplo:123e4567-e89b-12d3-a456-426614174000"]);
    expect(d.punto).toMatchObject({ lat: CENTRO.lat, lon: CENTRO.lon });
    expect(d.cp).toBe("7600");
    expect(d.localidad).toBe("Ciudad Guardada");
  });

  it("direccionId ajena o inexistente: como si no hubiera dirección guardada", async () => {
    const d = await resolverDestinoEnvio({
      destino: { direccionId: "123e4567-e89b-12d3-a456-426614174000", cp: "7601" },
      provincia: "Buenos Aires",
      clerkUserId: "user_ejemplo",
      leerDireccion: sinDirecciones,
    });
    expect(d.punto).toBeNull();
    expect(d.cp).toBe("7601");
  });

  it("dirección guardada sin lat/lon: sin punto, pero usa su CP y ciudad", async () => {
    const d = await resolverDestinoEnvio({
      destino: { direccionId: "123e4567-e89b-12d3-a456-426614174000" },
      provincia: null,
      clerkUserId: "user_ejemplo",
      leerDireccion: async () => ({ calle: "C 1", ciudad: "Ciudad", provincia: "Buenos Aires", cp: "7600", lat: null, lon: null }),
    });
    expect(d.punto).toBeNull();
    expect(d.cp).toBe("7600");
    // La provincia sale de la dirección si el body no la trae.
    expect(d.provinciaClave).toBe("buenosaires");
  });

  it("sin sesión no se lee ninguna dirección guardada", async () => {
    let leida = false;
    await resolverDestinoEnvio({
      destino: { direccionId: "123e4567-e89b-12d3-a456-426614174000" },
      provincia: "Buenos Aires",
      clerkUserId: null,
      leerDireccion: async () => ((leida = true), null),
    });
    expect(leida).toBe(false);
  });

  it("la dirección guardada con precisión: heurística por la altura de la calle", async () => {
    const con = await resolverDestinoEnvio({
      destino: { direccionId: "123e4567-e89b-12d3-a456-426614174000" },
      provincia: "Buenos Aires",
      clerkUserId: "u",
      leerDireccion: async () => ({ calle: "Av. Colón 2500", ciudad: "C", provincia: "Buenos Aires", cp: null, lat: CENTRO.lat, lon: CENTRO.lon }),
    });
    expect(con.punto?.precision).toBe("altura");
    const sin = await resolverDestinoEnvio({
      destino: { direccionId: "123e4567-e89b-12d3-a456-426614174000" },
      provincia: "Buenos Aires",
      clerkUserId: "u",
      leerDireccion: async () => ({ calle: "Av. Colón", ciudad: "C", provincia: "Buenos Aires", cp: null, lat: CENTRO.lat, lon: CENTRO.lon }),
    });
    expect(sin.punto?.precision).toBe("calle");
  });
});

describe("planEnvio", () => {
  const cfg = (extra: Partial<ConfigEnvio> = {}): ConfigEnvio => ({ ...CONFIG_ENVIO_DEFAULT, metodos: [metodoDePrueba()], ...extra });
  const destino = { provinciaClave: "buenosaires", punto: CENTRO };
  const origen = { sucursal: "mdp", conTraslado: false };

  it("sin métodos (flag apagado): no hay costoEnvioPara y todo queda como antes", () => {
    const p = planEnvio({ config: CONFIG_ENVIO_DEFAULT, provincia: "Buenos Aires", entregaTipo: "envio", destino, origen });
    expect(p.costoEnvioPara).toBeUndefined();
    expect(p.envioGratisAplica).toBe(true);
    expect(p.evaluar(1000)).toEqual({ disponible: true, gratis: false, aCoordinar: true, motivo: "gratis_apagado", faltante: 0 });
  });

  it("retiro: nunca hay costo de envío", () => {
    const p = planEnvio({ config: cfg(), provincia: "Buenos Aires", entregaTipo: "retiro", destino, origen });
    expect(p.costoEnvioPara).toBeUndefined();
  });

  it("envío con método que aplica: costoEnvioPara da la tarifa de la zona", () => {
    const p = planEnvio({ config: cfg(), provincia: "Buenos Aires", entregaTipo: "envio", destino, origen });
    expect(p.costoEnvioPara?.(10_000)).toBe(3000);
    expect(p.envioGratisAplica).toBe(false);
    expect(p.evaluar(10_000).metodo?.zona).toBe("Centro");
  });

  it("método con gratisAplica: el cupón de envío gratis puede anular la tarifa", () => {
    const p = planEnvio({ config: cfg({ metodos: [metodoDePrueba({ gratisAplica: true })] }), provincia: "Buenos Aires", entregaTipo: "envio", destino, origen });
    expect(p.envioGratisAplica).toBe(true);
    expect(p.evaluar(10_000, true)).toMatchObject({ gratis: true, costo: 0 });
  });

  it("destino sin zona: costoEnvioPara devuelve 0 (a coordinar)", () => {
    const p = planEnvio({
      config: cfg(),
      provincia: "Buenos Aires",
      entregaTipo: "envio",
      destino: { provinciaClave: "buenosaires", punto: puntoDePrueba("afuera") },
      origen,
    });
    expect(p.costoEnvioPara?.(10_000)).toBe(0);
    expect(p.envioGratisAplica).toBe(true);
  });

  it("sinUbicar: localidad atendida sin coordenadas", () => {
    const p = planEnvio({
      config: cfg(),
      provincia: "Buenos Aires",
      entregaTipo: "envio",
      destino: { provinciaClave: "buenosaires", georefId: "9990010" },
      origen,
    });
    expect(p.sinUbicar).toBe(true);
    expect(p.costoEnvioPara?.(10_000)).toBe(0);
  });
});

describe("origenDeEnvio", () => {
  it("sin contexto de disponibilidad: origen desconocido (la condición se ignora)", () => {
    expect(origenDeEnvio(undefined, null)).toBeNull();
  });

  it("zona del contexto y líneas a traer de la disponibilidad", () => {
    const disp = { zona: "mdp" } as never;
    expect(origenDeEnvio(disp, { productos: {}, locales: [], lineasATraer: [] })).toEqual({ sucursal: "mdp", conTraslado: false });
    expect(origenDeEnvio(disp, { productos: {}, locales: [], lineasATraer: ["10"] })).toEqual({ sucursal: "mdp", conTraslado: true });
  });

  it("contexto sin disponibilidad calculada (falló): sólo la zona", () => {
    expect(origenDeEnvio({ zona: "igz" } as never, null)).toEqual({ sucursal: "igz", conTraslado: false });
  });
});
