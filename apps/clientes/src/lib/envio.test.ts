import { describe, expect, it } from "vitest";
import {
  CIUDADES_ENVIO,
  MINIMO_ENVIO,
  costoEnvio,
  evaluarEnvio,
  pagosDisponibles,
} from "./envio";

/**
 * Estas reglas las comparten el checkout (client component) y la validación del
 * servidor. Si se desalinean, el shop muestra una opción que la API después
 * rechaza — el cliente completa todo el formulario y se come el error al final.
 */

describe("evaluarEnvio", () => {
  it("no ofrece envío por debajo del mínimo", () => {
    const r = evaluarEnvio(MINIMO_ENVIO - 1, "Puerto Iguazú");
    expect(r.disponible).toBe(false);
    expect(r.motivo).toBeTruthy();
  });

  it("ofrece envío justo en el mínimo", () => {
    expect(evaluarEnvio(MINIMO_ENVIO, "Puerto Iguazú").disponible).toBe(true);
  });

  it("acepta todas las ciudades declaradas", () => {
    for (const ciudad of CIUDADES_ENVIO) {
      expect(evaluarEnvio(MINIMO_ENVIO, ciudad).disponible, ciudad).toBe(true);
    }
  });

  it("rechaza una ciudad fuera de la zona propia y lo explica", () => {
    const r = evaluarEnvio(MINIMO_ENVIO, "Córdoba");
    expect(r.disponible).toBe(false);
    // El motivo se le muestra al cliente: tiene que decirle qué hacer, no solo
    // que no se puede.
    expect(r.motivo).toContain("Retiro");
  });

  it("pide elegir ciudad cuando no hay ninguna", () => {
    expect(evaluarEnvio(MINIMO_ENVIO, "").disponible).toBe(false);
    expect(evaluarEnvio(MINIMO_ENVIO, undefined).disponible).toBe(false);
    expect(evaluarEnvio(MINIMO_ENVIO, null).disponible).toBe(false);
  });

  it("el mínimo manda por sobre la ciudad", () => {
    // Monto insuficiente Y ciudad inválida: el motivo debe ser el del monto,
    // que es el que el cliente puede resolver agregando productos.
    const r = evaluarEnvio(0, "Córdoba");
    expect(r.disponible).toBe(false);
    expect(r.motivo).toContain("$");
  });
});

describe("costoEnvio", () => {
  it("hoy el envío es gratis cuando califica", () => {
    expect(costoEnvio("envio")).toBe(0);
    expect(costoEnvio("retiro")).toBe(0);
  });
});

describe("pagosDisponibles", () => {
  it("ofrece efectivo solo con retiro por el local", () => {
    expect(pagosDisponibles("retiro")).toContain("efectivo");
    expect(pagosDisponibles("envio")).not.toContain("efectivo");
  });

  it("siempre ofrece transferencia", () => {
    expect(pagosDisponibles("retiro")).toContain("transferencia");
    expect(pagosDisponibles("envio")).toContain("transferencia");
  });

  it("nunca devuelve una lista vacía", () => {
    // El checkout cae a `metodosPago[0]` cuando el elegido no está disponible:
    // una lista vacía dejaría el método en undefined y el pedido sin forma de pago.
    expect(pagosDisponibles("retiro").length).toBeGreaterThan(0);
    expect(pagosDisponibles("envio").length).toBeGreaterThan(0);
  });
});
