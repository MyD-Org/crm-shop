import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("./rate-limit", () => ({ permitirAsync: async () => true }));

import { ubicacionDelCuerpo, datosDelCuerpo } from "./direcciones-envio-api";
import { firmarGeo } from "./geo-token";
import { conSugerencia, FORMULARIO_VACIO } from "./direcciones-envio-cliente";

const SECRETO = "s3cr3t-placeholder-para-tests-pedidos-0123456789";
const geo = { lat: -37.99, lon: -57.55, calle: "Av. Colón 2500", ciudad: "Mar del Plata", provincia: "Buenos Aires", cp: "7600", precision: "altura" as const };

beforeEach(() => {
  process.env.GEOCODE_FIRMA_SECRET = SECRETO;
});
afterEach(() => {
  delete process.env.GEOCODE_FIRMA_SECRET;
});

describe("ubicacionDelCuerpo", () => {
  it("un token válido de la misma calle da la ubicación", () => {
    expect(ubicacionDelCuerpo({ geoToken: firmarGeo(geo) }, "Av. Colon 2500")).toEqual({ lat: -37.99, lon: -57.55 });
  });
  it("token de otra calle, falsificado o ausente: null", () => {
    expect(ubicacionDelCuerpo({ geoToken: firmarGeo(geo) }, "Av. Luro 100")).toBeNull();
    expect(ubicacionDelCuerpo({ geoToken: "x.y" }, "Av. Colón 2500")).toBeNull();
    expect(ubicacionDelCuerpo({}, "Av. Colón 2500")).toBeNull();
  });
  it("lat/lon sueltos en el cuerpo se ignoran", () => {
    expect(ubicacionDelCuerpo({ lat: -1, lon: -1 }, "Av. Colón 2500")).toBeNull();
  });
});

describe("datosDelCuerpo", () => {
  const cuerpo = (extra: object) =>
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ calle: "Av. Colón 2500", ciudad: "Mar del Plata", provincia: "Buenos Aires", cp: "7600", ...extra }),
    });

  it("trae la ubicación verificada junto a los datos", async () => {
    const r = await datosDelCuerpo(cuerpo({ geoToken: firmarGeo(geo) }));
    expect("datos" in r && r.ubicacion).toEqual({ lat: -37.99, lon: -57.55 });
  });
  it("sin token la ubicación es null", async () => {
    const r = await datosDelCuerpo(cuerpo({}));
    expect("datos" in r && r.ubicacion).toBeNull();
  });
});

describe("conSugerencia", () => {
  it("guarda el token de la sugerencia y lo reemplaza al elegir otra sin token", () => {
    const conToken = conSugerencia(FORMULARIO_VACIO, { calle: "A 1", ciudad: "X", provincia: "Misiones", cp: "3370", geoToken: "t" });
    expect(conToken.geoToken).toBe("t");
    expect(conSugerencia(conToken, { calle: "B 2", ciudad: "X", provincia: "Misiones", cp: "3370" })).not.toHaveProperty("geoToken");
  });
});
