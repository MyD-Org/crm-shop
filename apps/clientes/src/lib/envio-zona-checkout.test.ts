import { describe, expect, it } from "vitest";
import { camposPedidoEnvioZona, destinoParaCotizar, ubicacionVigente, type UbicacionElegida } from "./envio-zona-checkout";

const U: UbicacionElegida = { geoToken: "tok.en", calle: "Avenida Colón 2500", cp: "7600", precision: "altura" };
const base = { guardadaId: null, ubicacion: U, calleActual: "Avenida Colón 2500", ciudad: "Mar del Plata" };

describe("ubicacionVigente", () => {
  it("vale mientras la calle sea la firmada", () => {
    expect(ubicacionVigente(U, "  Avenida Colón 2500 ")).toBe(U);
  });
  it("editar la calle descarta la ubicación", () => {
    expect(ubicacionVigente(U, "Avenida Colón 2501")).toBeNull();
    expect(ubicacionVigente(null, "x")).toBeNull();
  });
});

describe("destinoParaCotizar", () => {
  it("dirección guardada: sólo su id (el servidor lee la ubicación)", () => {
    expect(destinoParaCotizar({ ...base, guardadaId: "id-1" })).toEqual({ direccionId: "id-1" });
  });
  it("sugerencia vigente: token, calle firmada, localidad y CP", () => {
    expect(destinoParaCotizar(base)).toEqual({ geoToken: "tok.en", calle: "Avenida Colón 2500", localidad: "Mar del Plata", cp: "7600" });
  });
  it("calle editada: sólo la localidad", () => {
    expect(destinoParaCotizar({ ...base, calleActual: "otra calle 1" })).toEqual({ localidad: "Mar del Plata" });
  });
  it("sin nada: vacío", () => {
    expect(destinoParaCotizar({ guardadaId: null, ubicacion: null, calleActual: "", ciudad: " " })).toEqual({});
  });
  it("nunca manda coordenadas", () => {
    expect(Object.keys(destinoParaCotizar(base))).not.toContain("lat");
    expect(Object.keys(destinoParaCotizar(base))).not.toContain("lon");
  });
});

describe("camposPedidoEnvioZona", () => {
  it("con token: entregaGeoToken, destino y costoEnvioVisto", () => {
    expect(camposPedidoEnvioZona({ entrada: base, envioACoordinar: false, costoEnvioVisto: 4500 })).toEqual({
      entregaGeoToken: "tok.en",
      destino: { localidad: "Mar del Plata", cp: "7600" },
      costoEnvioVisto: 4500,
    });
  });
  it("dirección guardada: direccionId", () => {
    expect(camposPedidoEnvioZona({ entrada: { ...base, guardadaId: "id-1" }, envioACoordinar: false, costoEnvioVisto: 0 })).toEqual({
      direccionId: "id-1",
      costoEnvioVisto: 0,
    });
  });
  it("envío a coordinar explícito", () => {
    const c = camposPedidoEnvioZona({ entrada: { ...base, ubicacion: null }, envioACoordinar: true, costoEnvioVisto: undefined });
    expect(c.envioACoordinar).toBe(true);
    expect(c).not.toHaveProperty("costoEnvioVisto");
    expect(c).not.toHaveProperty("entregaGeoToken");
  });
});
