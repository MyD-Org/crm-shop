import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, userMock, sesionMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  userMock: vi.fn(),
  sesionMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: userMock,
}));

vi.mock("@/db", () => ({
  getDb: () => {
    throw new Error("no debe tocar la DB");
  },
}));

vi.mock("./alegra", () => ({
  getContacto: vi.fn(),
  idPriceListUsable: vi.fn(),
}));

vi.mock("./vinculacion", () => ({
  intentarVinculacionPorEmail: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock("iron-session", () => ({
  getIronSession: sesionMock,
}));

import { esAdmin, identidadActual } from "./auth";

describe("esAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sesionMock.mockResolvedValue({ isLoggedIn: false });
  });

  it("true: Usuario con rol admin", async () => {
    authMock.mockResolvedValue({ userId: "user_1" });
    userMock.mockResolvedValue({ publicMetadata: { role: "admin" } });

    expect(await esAdmin()).toBe(true);
  });

  it("false: Usuario logueado sin rol", async () => {
    authMock.mockResolvedValue({ userId: "user_2" });
    userMock.mockResolvedValue({ publicMetadata: {} });

    expect(await esAdmin()).toBe(false);
  });

  it("false: Anónimo, y currentUser no se invoca", async () => {
    authMock.mockResolvedValue({ userId: null });

    expect(await esAdmin()).toBe(false);
    expect(userMock).not.toHaveBeenCalled();
  });

  it("false: Solo cookie del CRM (identidadActual sigue con origen cookie_crm)", async () => {
    authMock.mockResolvedValue({ userId: null });
    sesionMock.mockResolvedValue({
      isLoggedIn: true,
      codigocliente: "C001",
    });

    expect(await esAdmin()).toBe(false);
    const identidad = await identidadActual();
    expect(identidad.cliente?.origen).toBe("cookie_crm");
    expect(identidad.esAdmin).toBe(false);
  });

  it("false: Clerk falla, no propaga la excepción", async () => {
    authMock.mockResolvedValue({ userId: "user_3" });
    userMock.mockRejectedValue(new Error("clerk down"));

    await expect(esAdmin()).resolves.toBe(false);
  });
});
