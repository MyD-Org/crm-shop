import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  GEO_TOKEN_TTL_MS,
  GeoSecretoFaltanteError,
  firmarGeo,
  verificarGeo,
  type DatosGeo,
} from "./geo-token";

const SECRETO = "s3cr3t-placeholder-para-tests-geo-0123456789";
const AHORA = Date.UTC(2026, 10, 12, 15, 0, 0);

const datos: DatosGeo = {
  lat: -38.0055,
  lon: -57.5426,
  calle: "Av. Colón 2500",
  ciudad: "Mar del Plata",
  provincia: "Buenos Aires",
  cp: "7600",
  precision: "altura",
};

let previo: string | undefined;
beforeEach(() => {
  previo = process.env.GEOCODE_FIRMA_SECRET;
  process.env.GEOCODE_FIRMA_SECRET = SECRETO;
});
afterEach(() => {
  if (previo === undefined) delete process.env.GEOCODE_FIRMA_SECRET;
  else process.env.GEOCODE_FIRMA_SECRET = previo;
});

describe("geo-token", () => {
  it("firma y verifica: devuelve las coordenadas y la precisión", () => {
    const token = firmarGeo(datos, AHORA);
    const r = verificarGeo(token, { calle: "Av. Colón 2500" }, AHORA + 1000);
    expect(r).toEqual({
      lat: -38.0055,
      lon: -57.5426,
      precision: "altura",
      ciudad: "Mar del Plata",
      provincia: "Buenos Aires",
      cp: "7600",
    });
  });

  it("la calle se compara sin acentos, mayúsculas ni signos", () => {
    const token = firmarGeo(datos, AHORA);
    expect(verificarGeo(token, { calle: "av colon 2500" }, AHORA)).not.toBeNull();
  });

  it("rechaza si la calle enviada no es la firmada", () => {
    const token = firmarGeo(datos, AHORA);
    expect(verificarGeo(token, { calle: "Av. Colón 2600" }, AHORA)).toBeNull();
    expect(verificarGeo(token, { calle: "" }, AHORA)).toBeNull();
  });

  it("rechaza un token vencido (más de 24 h) y acepta justo antes", () => {
    const token = firmarGeo(datos, AHORA);
    expect(verificarGeo(token, { calle: datos.calle }, AHORA + GEO_TOKEN_TTL_MS - 1)).not.toBeNull();
    expect(verificarGeo(token, { calle: datos.calle }, AHORA + GEO_TOKEN_TTL_MS + 1)).toBeNull();
  });

  it("rechaza un token emitido en el futuro (reloj adulterado)", () => {
    const token = firmarGeo(datos, AHORA + 10 * 60 * 1000);
    expect(verificarGeo(token, { calle: datos.calle }, AHORA)).toBeNull();
  });

  it("rechaza un payload alterado con la firma original", () => {
    const token = firmarGeo(datos, AHORA);
    const [payload, firma] = token.split(".");
    const alterado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    alterado.lat = -34.6;
    const falso = `${Buffer.from(JSON.stringify(alterado)).toString("base64url")}.${firma}`;
    expect(verificarGeo(falso, { calle: datos.calle }, AHORA)).toBeNull();
  });

  it("rechaza un token firmado con otro secreto", () => {
    const payload = Buffer.from(JSON.stringify({ ...datos, iat: AHORA })).toString("base64url");
    const firma = createHmac("sha256", "otro-secreto-placeholder-0123456789abcdef").update(payload).digest("base64url");
    expect(verificarGeo(`${payload}.${firma}`, { calle: datos.calle }, AHORA)).toBeNull();
  });

  it("rechaza basura, vacío y tipos que no son string", () => {
    for (const t of ["", "x", "a.b", "a.b.c", ".", undefined, null, 5, {}]) {
      expect(verificarGeo(t as never, { calle: datos.calle }, AHORA)).toBeNull();
    }
  });

  it("rechaza coordenadas fuera de la caja argentina aunque estén firmadas", () => {
    const token = firmarGeo({ ...datos, lat: 40.4, lon: -3.7 }, AHORA);
    expect(verificarGeo(token, { calle: datos.calle }, AHORA)).toBeNull();
  });

  it("sin GEOCODE_FIRMA_SECRET, verificar devuelve null (no rompe) y firmar lanza", () => {
    const token = firmarGeo(datos, AHORA);
    delete process.env.GEOCODE_FIRMA_SECRET;
    expect(verificarGeo(token, { calle: datos.calle }, AHORA)).toBeNull();
    expect(() => firmarGeo(datos, AHORA)).toThrow(GeoSecretoFaltanteError);
  });

  it("un secreto demasiado corto se trata como faltante", () => {
    process.env.GEOCODE_FIRMA_SECRET = "corto";
    expect(() => firmarGeo(datos, AHORA)).toThrow(GeoSecretoFaltanteError);
  });
});
