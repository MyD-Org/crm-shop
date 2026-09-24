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

import {
  comercialEspejo,
  contactoPorDocumento,
  contactoPorId,
  contactosPorEmail,
  idListaGeneral,
  tipoCuentaEspejo,
  vinculablePorId,
} from "./contactos-espejo";

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

describe("tipoCuentaEspejo (layout de Mi cuenta)", () => {
  it("lee sólo tipo_cuenta de la vista, con los mismos filtros", async () => {
    grabadora = dbGrabadora(() => [["corriente"]]);
    expect(await tipoCuentaEspejo("42")).toBe("corriente");
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toMatch(/^select "tipo_cuenta" from "public"\."alegra_contacts_shop"/);
    expect(consulta.params).toEqual(expect.arrayContaining(["tenant-test", "principal", "42", "active"]));
  });

  it("contado o nulo en el espejo ⇒ contado", async () => {
    grabadora = dbGrabadora(() => [[null]]);
    expect(await tipoCuentaEspejo("42")).toBe("contado");
  });

  it("sin fila: null y NUNCA consulta Alegra en vivo", async () => {
    grabadora = dbGrabadora(() => []);
    expect(await tipoCuentaEspejo("7")).toBeNull();
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("id inválido: null sin consultar", async () => {
    grabadora = dbGrabadora(() => [["corriente"]]);
    expect(await tipoCuentaEspejo("../x")).toBeNull();
    expect(grabadora.consultas).toHaveLength(0);
  });
});

/**
 * Lecturas de la vinculación y de la lista de precios (rebanada 3): SÓLO espejo,
 * nunca Alegra. Fila en el orden de `columnasVinculables`: alegraId, name,
 * identification, email, types, priceListId, priceListName, priceListStatus,
 * tipoCuenta. Datos inventados.
 */
const VINCULABLE: unknown[] = ["42", "Cliente Uno SA", "20-12345678-9", "compras@cliente.example", ["client"], "7", "Mayorista", "active", "corriente"];

describe("contactosPorEmail", () => {
  it("normaliza el email (mayúsculas y espacios) y filtra tenant, cuenta, activa y clientes", async () => {
    grabadora = dbGrabadora(() => [VINCULABLE]);
    const r = await contactosPorEmail("  Compras@Cliente.EXAMPLE ");
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toContain('from "public"."alegra_contacts_shop"');
    expect(consulta.sql).toMatch(/"emails_norm" @> \$\d/);
    expect(consulta.sql).toMatch(/"types" @> \$\d/);
    expect(consulta.params).toEqual(
      // drizzle serializa el array como literal de Postgres.
      expect.arrayContaining(["tenant-test", "principal", "active", '{"compras@cliente.example"}', '{"client"}']),
    );
    expect(r).toEqual([
      {
        id: "42",
        name: "Cliente Uno SA",
        identification: "20-12345678-9",
        email: "compras@cliente.example",
        types: ["client"],
        priceList: { id: "7", name: "Mayorista", status: "active" },
        tipoCuenta: "corriente",
      },
    ]);
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("email vacío: no consulta", async () => {
    grabadora = dbGrabadora(() => [VINCULABLE]);
    expect(await contactosPorEmail("  ")).toEqual([]);
    expect(grabadora.consultas).toHaveLength(0);
  });
});

describe("contactoPorDocumento", () => {
  it("compara sólo dígitos contra identification_norm", async () => {
    grabadora = dbGrabadora(() => [VINCULABLE]);
    const c = await contactoPorDocumento("20-12345678-9");
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toMatch(/"identification_norm" = \$\d/);
    expect(consulta.params).toContain("20123456789");
    expect(consulta.params).not.toContain("20-12345678-9");
    expect(c?.id).toBe("42");
  });

  it("desempate determinístico: primero clientes, después id numérico menor", async () => {
    grabadora = dbGrabadora(() => [VINCULABLE]);
    await contactoPorDocumento("20123456789");
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toMatch(/order by \('client' = ANY\("alegra_contacts_shop"\."types"\)\) DESC, CASE WHEN .*::numeric END ASC NULLS LAST, .*"alegra_id" asc limit/);
  });

  it("sin fila: null; sin dígitos: no consulta", async () => {
    grabadora = dbGrabadora(() => []);
    expect(await contactoPorDocumento("20123456789")).toBeNull();
    expect(await contactoPorDocumento("--")).toBeNull();
    expect(grabadora.consultas).toHaveLength(1);
  });
});

describe("vinculablePorId y comercialEspejo", () => {
  it("vinculablePorId lee sólo el espejo, sin respaldo en vivo", async () => {
    grabadora = dbGrabadora(() => []);
    expect(await vinculablePorId("42")).toBeNull();
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("comercialEspejo: lista activa ⇒ su id; tipo de la columna", async () => {
    grabadora = dbGrabadora(() => [VINCULABLE]);
    expect(await comercialEspejo("42")).toEqual({ tipoCuenta: "corriente", idPriceList: "7" });
  });

  it("comercialEspejo: lista dada de baja ⇒ principal (undefined)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fila = [...VINCULABLE];
    fila[7] = "inactive";
    grabadora = dbGrabadora(() => [fila]);
    expect(await comercialEspejo("42")).toEqual({ tipoCuenta: "corriente", idPriceList: undefined });
  });

  it("comercialEspejo: sin lista ⇒ principal; sin fila ⇒ null", async () => {
    const fila = [...VINCULABLE];
    fila[5] = null;
    grabadora = dbGrabadora(() => [fila]);
    expect(await comercialEspejo("42")).toEqual({ tipoCuenta: "corriente", idPriceList: undefined });
    grabadora = dbGrabadora(() => []);
    expect(await comercialEspejo("42")).toBeNull();
  });
});

describe("idListaGeneral (motivo otra_lista_precios)", () => {
  it("la lista `main` de un ítem activo del espejo de productos, del tenant", async () => {
    grabadora = dbGrabadora(() => [[[{ idPriceList: 5, price: 90, main: false }, { idPriceList: 1, price: 100, main: true }]]]);
    expect(await idListaGeneral()).toBe("1");
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toMatch(/from "public"\."catalog_products_shop"/);
    expect(consulta.sql).toContain('@> \'[{"main": true}]\'::jsonb');
    expect(consulta.params).toEqual(expect.arrayContaining(["tenant-test", true]));
  });

  it("sin ítems o la vista falla ⇒ null, sin tirar", async () => {
    grabadora = dbGrabadora(() => []);
    expect(await idListaGeneral()).toBeNull();
    grabadora = dbGrabadora(() => {
      throw Object.assign(new Error("x"), { code: "42501" });
    });
    expect(await idListaGeneral()).toBeNull();
  });
});
