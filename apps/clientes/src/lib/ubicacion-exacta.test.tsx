import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { firmarGeo } from "./geo-token";
import { armarEleccion, serializarCookieUbicacion, validarCookieUbicacion, type EleccionUbicacion } from "./ubicacion";
import { ubicacionExactaVerificada } from "./ubicacion-exacta";
import { estimarEnvioPorPunto } from "./envio-zona-textos";
import { precargaDeUbicacion, ubicacionVigente } from "./envio-zona-checkout";
import { PUNTOS, metodoDePrueba } from "@/test/envio-metodo";
import { FilaEnvioZona } from "@/components/carrito/FilaEnvioZona";

const SECRETO = "s3cr3t-placeholder-para-tests-pedidos-0123456789";
const AHORA = new Date("2026-11-16T14:00:00Z");

beforeEach(() => {
  vi.stubEnv("GEOCODE_FIRMA_SECRET", SECRETO);
});

const token = (p: { lat: number; lon: number }, calle = "Avenida Colón 2500", cp = "7600") =>
  firmarGeo({ ...p, calle, ciudad: "Mar del Plata", provincia: "Buenos Aires", cp, precision: "altura" });

const eleccion = (geoToken: string, calle = "Avenida Colón 2500"): EleccionUbicacion => ({
  tipo: "envio",
  localidad: "Mar del Plata",
  provincia: "buenosaires",
  exacta: { calle, zona: "Centro", geoToken },
});

describe("cookie con punto exacto", () => {
  it("ida y vuelta: calle, zona y token; nunca lat/lon", () => {
    const t = token(PUNTOS.centro);
    // Un lat/lon suelto en la entrada (desde el cuerpo de un POST) nunca llega a la cookie.
    const entrada = { tipo: "envio", localidad: "Mar del Plata", provincia: "buenosaires", cp: "7600", calle: "Avenida Colón 2500", zona: "Centro", geoToken: t, lat: -38, lon: -57.58 };
    const c = armarEleccion(entrada);
    const crudo = serializarCookieUbicacion(c!);
    expect(JSON.parse(crudo)).toEqual({ tipo: "envio", localidad: "Mar del Plata", provincia: "buenosaires", cp: "7600", calle: "Avenida Colón 2500", zona: "Centro", geoToken: t });
    expect(validarCookieUbicacion(crudo)).toEqual(c);
  });

  it("calle sin token (o token con formato roto): se descarta el punto exacto", () => {
    const base = { tipo: "envio", localidad: "Mar del Plata", provincia: "buenosaires" };
    expect(armarEleccion({ ...base, calle: "Colón 1" })).not.toHaveProperty("calle");
    expect(armarEleccion({ ...base, calle: "Colón 1", geoToken: "no es un token" })).not.toHaveProperty("geoToken");
  });

  it("una dirección guardada no arrastra el punto exacto", () => {
    const c = armarEleccion({ tipo: "envio", localidad: "Mar del Plata", provincia: "buenosaires", direccionId: "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10", calle: "Colón 1", geoToken: "a.b" });
    expect(c).not.toHaveProperty("geoToken");
  });
});

describe("ubicacionExactaVerificada", () => {
  it("token vigente con la misma calle: destino con el punto verificado", () => {
    const x = ubicacionExactaVerificada(eleccion(token(PUNTOS.centro)), "buenosaires");
    expect(x?.destino.punto).toMatchObject({ ...PUNTOS.centro, precision: "altura" });
    expect(x?.cp).toBe("7600");
  });

  it("token de otra calle, vencido, adulterado o sin secreto: null", () => {
    expect(ubicacionExactaVerificada(eleccion(token(PUNTOS.centro), "Otra Calle 1"), "buenosaires")).toBeNull();
    expect(ubicacionExactaVerificada(eleccion(token(PUNTOS.centro)), "buenosaires", AHORA.getTime() + 25 * 3600_000 * 10)).toBeNull();
    expect(ubicacionExactaVerificada(eleccion(token(PUNTOS.centro) + "x"), "buenosaires")).toBeNull();
    const t = token(PUNTOS.centro);
    vi.stubEnv("GEOCODE_FIRMA_SECRET", "");
    expect(ubicacionExactaVerificada(eleccion(t), "buenosaires")).toBeNull();
  });

  it("sin punto exacto o con retiro: null", () => {
    expect(ubicacionExactaVerificada({ tipo: "envio", localidad: "X", provincia: "buenosaires" }, "buenosaires")).toBeNull();
    expect(ubicacionExactaVerificada({ tipo: "ninguna" }, null)).toBeNull();
  });
});

describe("ficha: tarifa exacta vs. listado por localidad", () => {
  const destino = (p: { lat: number; lon: number }) => ubicacionExactaVerificada(eleccion(token(p)), "buenosaires")!.destino;

  it("el punto cae en una zona: «Envío en el día: $X» exacto, con llegada", () => {
    const e = estimarEnvioPorPunto([metodoDePrueba()], destino(PUNTOS.centro), AHORA)!;
    expect(e.tipo).toBe("exacto");
    expect(e.precio).toBe(3000);
    expect(e.texto).toMatch(/^Envío en el día: \$\s?3\.000$/);
    expect(e.llegada.texto).toBeTruthy();
    expect(e).not.toHaveProperty("zonas");
  });

  it("otro punto, otra zona (la tarifa no es la de la localidad entera)", () => {
    expect(estimarEnvioPorPunto([metodoDePrueba()], destino(PUNTOS.costa), AHORA)?.precio).toBe(4500);
  });

  it("fuera de toda zona: null (costo a coordinar)", () => {
    // Sin CP que cubra otra zona: con el CP 7600 aplicaría la regla `cp` igual que en el pedido.
    const d = ubicacionExactaVerificada(eleccion(token(PUNTOS.afuera, "Avenida Colón 2500", "")), "buenosaires")!.destino;
    expect(estimarEnvioPorPunto([metodoDePrueba()], d, AHORA)).toBeNull();
  });

  it("sin métodos (flag apagado) o sin punto: null", () => {
    expect(estimarEnvioPorPunto(undefined, destino(PUNTOS.centro), AHORA)).toBeNull();
    expect(estimarEnvioPorPunto([metodoDePrueba()], { provinciaClave: "buenosaires" }, AHORA)).toBeNull();
  });
});

describe("EnvioProductoUbicacion", { timeout: 30_000 }, () => {
  async function ficha(elec: EleccionUbicacion, metodos = [metodoDePrueba()]) {
    vi.resetModules();
    vi.doMock("next/server", () => ({ connection: async () => {} }));
    vi.doMock("@/lib/ubicacion-servidor", () => ({
      ubicacionDelVisitante: async () => ({
        ubicacion: elec.tipo === "envio" ? { localidad: "Mar del Plata", provincia: "buenosaires" } : null,
        origen: "cookie",
        eleccion: elec,
        nombrePila: null,
      }),
    }));
    vi.doMock("@/components/ubicacion/SelectorUbicacion", () => ({ SelectorUbicacion: () => null }));
    const { EnvioProductoUbicacion } = await import("@/components/producto/EnvioProductoUbicacion");
    const { CONFIG_ENVIO_DEFAULT } = await import("./envio");
    const node = await EnvioProductoUbicacion({ configEnvio: { ...CONFIG_ENVIO_DEFAULT, domicilioActivo: true, metodos } });
    return renderToStaticMarkup(<>{node}</>);
  }

  it("con punto vigente muestra la tarifa exacta", async () => {
    const html = await ficha(eleccion(token(PUNTOS.centro)));
    expect(html).toMatch(/Llega [^<]* por \$\s?3\.000/);
    expect(html).toMatch(/3\.000/);
    expect(html).not.toMatch(/desde/);
  });

  it("token vencido o de otra calle: lo de hoy (por localidad)", async () => {
    const html = await ficha(eleccion(token(PUNTOS.centro), "Otra Calle 1"));
    expect(html).not.toMatch(/\b3\.000\b/);
  });

  it("flag apagado (sin métodos): no hay tarifa por zona aunque la cookie traiga el punto", async () => {
    const html = await ficha(eleccion(token(PUNTOS.centro)), []);
    expect(html).not.toContain("Envío en el día");
  });
});

describe("carrito: FilaEnvioZona con zona exacta", () => {
  const metodo = { zona: "Centro", horario: { dias: [1, 2, 3, 4, 5], horaCorte: "09:00", margenMin: 0 } };

  it("muestra el importe y «Envío en el día» con la llegada", () => {
    const html = renderToStaticMarkup(<FilaEnvioZona costo={3000} gratis={false} estimado={undefined} metodo={metodo} />);
    expect(html).toContain("3.000");
    expect(html).toContain("Envío en el día");
    expect(html).toContain("Llega");
  });

  it("sin método queda igual que antes (sin la línea de llegada)", () => {
    const html = renderToStaticMarkup(<FilaEnvioZona costo={3000} gratis={false} estimado={undefined} />);
    expect(html).not.toContain("Llega");
  });
});

describe("checkout: precarga de la ubicación exacta", () => {
  const exacta = { calle: "Avenida Colón 2500", localidad: "Mar del Plata", cp: "7600", geoToken: "a.b", precision: "altura" as const };
  const elec = { tipo: "envio" as const, provincia: "buenosaires", exacta };

  it("formulario vacío (sin direcciones guardadas) y flag: precarga calle, localidad, CP y token", () => {
    const p = precargaDeUbicacion({ eleccion: elec, envioPorZona: true, direccionesGuardadas: 0 })!;
    expect(p.direccion).toBe("Avenida Colón 2500");
    expect(p.ciudad).toBe("Mar del Plata");
    expect(p.ubicacion).toEqual({ geoToken: "a.b", calle: "Avenida Colón 2500", cp: "7600", precision: "altura" });
    // Va como entregaGeoToken igual que una sugerencia elegida.
    expect(ubicacionVigente(p.ubicacion, p.direccion)).toBe(p.ubicacion);
  });

  it("si el cliente edita la calle, el token deja de valer", () => {
    const p = precargaDeUbicacion({ eleccion: elec, envioPorZona: true, direccionesGuardadas: 0 })!;
    expect(ubicacionVigente(p.ubicacion, "Avenida Colón 2501")).toBeNull();
  });

  it("con dirección guardada del usuario no pisa nada", () => {
    expect(precargaDeUbicacion({ eleccion: elec, envioPorZona: true, direccionesGuardadas: 1 })).toBeNull();
  });

  it("flag apagado, retiro o sin punto exacto: nada", () => {
    expect(precargaDeUbicacion({ eleccion: elec, envioPorZona: false, direccionesGuardadas: 0 })).toBeNull();
    expect(precargaDeUbicacion({ eleccion: { tipo: "retiro" }, envioPorZona: true, direccionesGuardadas: 0 })).toBeNull();
    expect(precargaDeUbicacion({ eleccion: { tipo: "envio", provincia: "buenosaires" }, envioPorZona: true, direccionesGuardadas: 0 })).toBeNull();
    expect(precargaDeUbicacion({ eleccion: null, envioPorZona: true, direccionesGuardadas: 0 })).toBeNull();
  });
});
