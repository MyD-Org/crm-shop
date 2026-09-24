import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * `contactoPorId`: espejo primero, filtrado por tenant del Shop, cuenta
 * principal y fila activa; sin fila, UNA consulta en vivo; si falla, null.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

const getContacto = vi.fn();
vi.mock("./alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./alegra")>()),
  getContacto: (id: string) => getContacto(id),
}));

import { contactoPorId } from "./contactos-espejo";

/** Fila de la vista en el orden del select de `delEspejo`. */
const FILA = ["42", "Cliente Uno SA", "20-12345678-9", "compras@cliente.example", "corriente", "Mayorista", "Vendedor Uno", "30 días", 30, "1000000.00"];

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  getContacto.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("contactoPorId", () => {
  it("con fila en el espejo: la mapea y no llama a Alegra", async () => {
    grabadora = dbGrabadora(() => [FILA]);
    const c = await contactoPorId("42");
    expect(getContacto).not.toHaveBeenCalled();
    expect(c).toEqual({
      alegraId: "42",
      nombre: "Cliente Uno SA",
      identificacion: "20-12345678-9",
      email: "compras@cliente.example",
      tipoCuenta: "corriente",
      listaPrecios: "Mayorista",
      vendedor: "Vendedor Uno",
      plazoNombre: "30 días",
      plazoDias: 30,
      limiteCredito: 1_000_000,
      origen: "espejo",
    });
  });

  it("filtra por tenant del Shop, cuenta principal, id y fila activa en la vista", async () => {
    grabadora = dbGrabadora(() => [FILA]);
    await contactoPorId("42");
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toContain('from "public"."alegra_contacts_shop"');
    expect(consulta.sql).toMatch(/"tenant_id" = \$\d/);
    expect(consulta.sql).toMatch(/"alegra_account" = \$\d/);
    expect(consulta.sql).toMatch(/"status" = \$\d/);
    expect(consulta.params).toEqual(expect.arrayContaining(["tenant-test", "principal", "42", "active"]));
    // Otro tenant nunca entra: el único tenant de la consulta es el del Shop.
    expect(consulta.params).not.toContain("otro-tenant");
  });

  it("sin fila: una sola consulta en vivo, con el mismo mapeo", async () => {
    grabadora = dbGrabadora(() => []);
    getContacto.mockResolvedValue({
      id: "7",
      name: "Cliente Contado",
      identification: "30111222333",
      email: "",
      term: { name: "Contado", days: 0 },
      creditLimit: null,
      priceList: null,
    });
    const c = await contactoPorId("7");
    expect(getContacto).toHaveBeenCalledTimes(1);
    expect(c).toMatchObject({
      alegraId: "7",
      nombre: "Cliente Contado",
      email: null,
      tipoCuenta: "contado",
      plazoDias: 0,
      limiteCredito: null,
      origen: "vivo",
    });
  });

  it("sin fila y Alegra falla: null, sin tirar", async () => {
    grabadora = dbGrabadora(() => []);
    getContacto.mockRejectedValue(new Error("Alegra 503 en /contacts/7: cuerpo"));
    expect(await contactoPorId("7")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.not.stringContaining("cuerpo"));
  });

  it("id inválido: null sin consultar nada", async () => {
    grabadora = dbGrabadora(() => [FILA]);
    expect(await contactoPorId("../x")).toBeNull();
    expect(grabadora.consultas).toHaveLength(0);
    expect(getContacto).not.toHaveBeenCalled();
  });
});
