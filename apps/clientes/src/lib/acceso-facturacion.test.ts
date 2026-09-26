import { beforeEach, describe, expect, it, vi } from "vitest";

const identidad = vi.fn();
const tipoCuenta = vi.fn();
vi.mock("./auth", () => ({ identidadActual: () => identidad() }));
vi.mock("./contactos-espejo", () => ({ tipoCuentaEspejo: (...a: unknown[]) => tipoCuenta(...a) }));

import { accesoFacturacion } from "./acceso-facturacion";

beforeEach(() => {
  identidad.mockReset();
  tipoCuenta.mockReset();
});

describe("accesoFacturacion", () => {
  it("sin vínculo: sin acceso y sin leer el espejo", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    expect(await accesoFacturacion()).toBe(false);
    expect(tipoCuenta).not.toHaveBeenCalled();
  });

  it("vinculado cuenta corriente: con acceso, leído con el código de la identidad", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42" } });
    tipoCuenta.mockResolvedValue("corriente");
    expect(await accesoFacturacion()).toBe(true);
    expect(tipoCuenta).toHaveBeenCalledWith("42");
  });

  it("vinculado de contado o sin fila en el espejo: sin acceso", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: { codigocliente: "42" } });
    tipoCuenta.mockResolvedValue("contado");
    expect(await accesoFacturacion()).toBe(false);
    tipoCuenta.mockResolvedValue(null);
    expect(await accesoFacturacion()).toBe(false);
  });

  it("espejo caído: sin acceso y el log sin datos del contacto", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", razonsocial: "ACME SA" } });
    tipoCuenta.mockRejectedValue(new TypeError("fetch failed"));
    expect(await accesoFacturacion()).toBe(false);
    const log = error.mock.calls.flat().join(" ");
    expect(log).toContain("TypeError");
    expect(log).not.toContain("42");
    expect(log).not.toContain("ACME");
    error.mockRestore();
  });
});
