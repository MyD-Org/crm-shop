import { beforeEach, describe, expect, it, vi } from "vitest";

const identidad = vi.fn();
const acceso = vi.fn();
vi.mock("./auth", () => ({ identidadActual: () => identidad() }));
vi.mock("./contactos-espejo", () => ({ accesoFacturacionEspejo: (...a: unknown[]) => acceso(...a) }));

import { accesoFacturacion } from "./acceso-facturacion";

beforeEach(() => {
  identidad.mockReset();
  acceso.mockReset();
});

describe("accesoFacturacion", () => {
  it("sin vínculo: sin acceso y sin leer el espejo", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    expect(await accesoFacturacion()).toBe(false);
    expect(acceso).not.toHaveBeenCalled();
  });

  it("vinculado cuenta corriente (la vista informa acceso): con acceso, leído con el código de la identidad", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42" } });
    acceso.mockResolvedValue(true);
    expect(await accesoFacturacion()).toBe(true);
    expect(acceso).toHaveBeenCalledWith("42");
  });

  it("vinculado de contado con excepción del CRM: con acceso (la vista ya suma la excepción)", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "43", tipoCuenta: "contado" } });
    acceso.mockResolvedValue(true);
    expect(await accesoFacturacion()).toBe(true);
  });

  it("de contado sin excepción, sin fila o contacto inactivo en el espejo: sin acceso", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: { codigocliente: "42" } });
    acceso.mockResolvedValue(false);
    expect(await accesoFacturacion()).toBe(false);
    acceso.mockResolvedValue(null);
    expect(await accesoFacturacion()).toBe(false);
  });

  it("espejo caído: sin acceso y el log sólo con el nombre del error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", razonsocial: "ACME SA" } });
    acceso.mockRejectedValue(new TypeError("fetch failed"));
    expect(await accesoFacturacion()).toBe(false);
    const log = error.mock.calls.flat().join(" ");
    expect(log).toContain("TypeError");
    expect(log).not.toContain("42");
    expect(log).not.toContain("ACME");
    expect(log).not.toContain("fetch failed");
    error.mockRestore();
  });
});
