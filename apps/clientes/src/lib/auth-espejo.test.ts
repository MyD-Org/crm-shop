import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Tipo de cuenta y lista de precios del cliente vinculado: el ESPEJO de
 * contactos gana sobre el snapshot de `client_links`; sin fila, el snapshot; sin
 * nada, indefinido (lista principal). Nunca Alegra en vivo. Datos inventados.
 */

const { authMock, userMock } = vi.hoisted(() => ({ authMock: vi.fn(), userMock: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock, currentUser: userMock }));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock("iron-session", () => ({ getIronSession: vi.fn().mockResolvedValue({ isLoggedIn: false }) }));
vi.mock("./vinculacion", () => ({ intentarVinculacionPorEmail: vi.fn().mockResolvedValue(null) }));

const getContacto = vi.fn();
vi.mock("./alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./alegra")>()),
  getContacto: (id: string) => getContacto(id),
}));

/** Fila del espejo en el orden de `columnasVinculables`. */
let espejo: unknown[][] | Error = [];
/** Vínculo activo: tipo_cuenta e id_price_list del snapshot. */
let vinculo: { tipoCuenta: string | null; idPriceList: string | null } | null = null;

function responder(c: ConsultaGrabada): unknown[][] | undefined {
  if (c.sql.includes('"alegra_contacts_shop"')) {
    if (espejo instanceof Error) throw espejo;
    return espejo;
  }
  if (c.sql.includes('"client_links"') && vinculo) {
    // `idPriceListCliente` selecciona sólo la lista; `vinculacionDe`, la fila entera.
    if (c.sql.startsWith('select "id_price_list"')) return [[vinculo.idPriceList]];
    return [[
      "00000000-0000-0000-0000-000000000001", "user_1", "42", "Cliente 42 SA", "20-12345678-9",
      vinculo.idPriceList, vinculo.tipoCuenta, "activa", "email_verificado",
      new Date().toISOString(), null,
    ]];
  }
  return [];
}
let grabadora = dbGrabadora(responder);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { identidadActual, idPriceListCliente } from "./auth";

function filaEspejo(tipo: "corriente" | "contado", lista: string | null, estadoLista = "active") {
  return ["42", "Cliente 42 SA", "20-12345678-9", null, ["client"], lista, "Lista", estadoLista, tipo, tipo === "corriente"];
}

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  espejo = [];
  vinculo = null;
  grabadora = dbGrabadora(responder);
  getContacto.mockReset();
  authMock.mockResolvedValue({ userId: "user_1" });
  userMock.mockResolvedValue({
    primaryEmailAddress: { emailAddress: "compras@cliente.example", verification: { status: "verified" } },
    publicMetadata: {},
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("identidadActual: tipo de cuenta y lista del vínculo", () => {
  it("snapshot sin tipo_cuenta + fila corriente en el espejo ⇒ corriente", async () => {
    vinculo = { tipoCuenta: null, idPriceList: null };
    espejo = [filaEspejo("corriente", "7")];
    const { cliente } = await identidadActual();
    expect(cliente).toMatchObject({ codigocliente: "42", tipoCuenta: "corriente", idPriceList: "7" });
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("sin fila en el espejo y snapshot vacío ⇒ indefinido (como hoy)", async () => {
    vinculo = { tipoCuenta: null, idPriceList: null };
    const { cliente } = await identidadActual();
    expect(cliente?.tipoCuenta).toBeUndefined();
    expect(cliente?.idPriceList).toBeUndefined();
  });

  it("espejo contado + snapshot corriente ⇒ contado (el espejo gana)", async () => {
    vinculo = { tipoCuenta: "corriente", idPriceList: "3" };
    espejo = [filaEspejo("contado", null)];
    const { cliente } = await identidadActual();
    expect(cliente?.tipoCuenta).toBe("contado");
    // El espejo dice "sin lista": principal, aunque el snapshot tenga una vieja.
    expect(cliente?.idPriceList).toBeUndefined();
  });

  it("el espejo no responde ⇒ snapshot, sin tirar", async () => {
    vinculo = { tipoCuenta: "corriente", idPriceList: "3" };
    espejo = Object.assign(new Error("permission denied"), { code: "42501" });
    const { cliente } = await identidadActual();
    expect(cliente).toMatchObject({ tipoCuenta: "corriente", idPriceList: "3" });
  });
});

describe("idPriceListCliente (carrito y pedidos)", () => {
  it("lista activa en el espejo ⇒ su id, 0 llamadas a Alegra y sin leer el snapshot", async () => {
    vinculo = { tipoCuenta: null, idPriceList: "3" };
    espejo = [filaEspejo("corriente", "7")];
    expect(await idPriceListCliente("42")).toBe("7");
    expect(getContacto).not.toHaveBeenCalled();
    expect(grabadora.consultas.some((c) => c.sql.includes('"client_links"'))).toBe(false);
  });

  it("lista inactive en el espejo ⇒ principal (undefined)", async () => {
    vinculo = { tipoCuenta: null, idPriceList: "3" };
    espejo = [filaEspejo("corriente", "7", "inactive")];
    expect(await idPriceListCliente("42")).toBeUndefined();
  });

  it("sin fila en el espejo ⇒ snapshot de client_links", async () => {
    vinculo = { tipoCuenta: null, idPriceList: "3" };
    expect(await idPriceListCliente("42")).toBe("3");
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("sin fila ni snapshot ⇒ undefined (lista principal)", async () => {
    expect(await idPriceListCliente("42")).toBeUndefined();
  });

  it("el espejo falla ⇒ snapshot", async () => {
    vinculo = { tipoCuenta: null, idPriceList: "3" };
    espejo = new Error("timeout");
    expect(await idPriceListCliente("42")).toBe("3");
  });
});
