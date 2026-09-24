import { beforeEach, describe, expect, it, vi } from "vitest";

const identidad = vi.fn();
vi.mock("../auth", () => ({ identidadActual: () => identidad() }));

import { jsonNoStore, requerirCliente, SIN_SESION, SIN_VINCULO } from "./guard";

beforeEach(() => {
  identidad.mockReset();
});

describe("requerirCliente", () => {
  it("anónimo: 401 en usted y no-store", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    const { error } = await requerirCliente();
    expect(error?.status).toBe(401);
    expect(error?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await error?.json()).toEqual({ error: SIN_SESION });
  });

  it("con sesión sin vínculo: 403", async () => {
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: null });
    const { error } = await requerirCliente();
    expect(error?.status).toBe(403);
    expect(await error?.json()).toEqual({ error: SIN_VINCULO });
  });

  it("vinculado (también por la cookie del portal): el cliente de la identidad", async () => {
    const cliente = { codigocliente: "42", origen: "cookie_crm" };
    identidad.mockResolvedValue({ clerkUserId: null, cliente });
    expect(await requerirCliente()).toEqual({ cliente });
  });
});

describe("jsonNoStore", () => {
  it("agrega private, no-store", () => {
    const r = jsonNoStore({ ok: true }, { status: 400 });
    expect(r.status).toBe(400);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
