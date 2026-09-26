import { beforeEach, describe, expect, it, vi } from "vitest";

const identidad = vi.fn();
const acceso = vi.fn();
vi.mock("../auth", () => ({ identidadActual: () => identidad() }));
vi.mock("../acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));

import { jsonNoStore, NO_DISPONIBLE, requerirCuentaCorriente, SIN_SESION } from "./guard";

beforeEach(() => {
  identidad.mockReset();
  acceso.mockReset();
  acceso.mockResolvedValue(true);
});

describe("requerirCuentaCorriente", () => {
  it("anónimo: 401 en usted y no-store", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    const { error } = await requerirCuentaCorriente();
    expect(error?.status).toBe(401);
    expect(error?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await error?.json()).toEqual({ error: SIN_SESION });
  });

  it("con sesión sin vínculo: 404, sin leer el espejo", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    const { error } = await requerirCuentaCorriente();
    expect(error?.status).toBe(404);
    expect(error?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await error?.json()).toEqual({ error: NO_DISPONIBLE });
    expect(acceso).not.toHaveBeenCalled();
  });

  it("vinculado de contado (o espejo caído): 404", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    acceso.mockResolvedValue(false);
    const { error } = await requerirCuentaCorriente();
    expect(error?.status).toBe(404);
    expect(await error?.json()).toEqual({ error: NO_DISPONIBLE });
  });

  it("cuenta corriente (también por la cookie del portal): el cliente de la identidad", async () => {
    const cliente = { codigocliente: "42", origen: "cookie_crm" };
    identidad.mockResolvedValue({ clerkUserId: null, cliente });
    expect(await requerirCuentaCorriente()).toEqual({ cliente });
  });
});

describe("jsonNoStore", () => {
  it("agrega private, no-store", () => {
    const r = jsonNoStore({ ok: true }, { status: 400 });
    expect(r.status).toBe(400);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
