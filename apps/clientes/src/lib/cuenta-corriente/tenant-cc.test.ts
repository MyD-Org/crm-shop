import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));
let marca: { nombre: string; recursosCentral: boolean } = { nombre: "Central LED", recursosCentral: true };
vi.mock("../marca", () => ({ getMarca: async () => marca }));

import { datosTenant } from "./tenant-cc";

beforeEach(() => {
  marca = { nombre: "Central LED", recursosCentral: true };
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("datosTenant", () => {
  it("lee sólo las columnas del GRANT, del tenant del Shop, y normaliza el WhatsApp", async () => {
    grabadora = dbGrabadora(() => [["tenant-test", "Empresa Demo", "+54 9 11 0000-0000", "comprobantes@cliente.example"]]);
    expect(await datosTenant()).toEqual({
      id: "tenant-test",
      nombre: "Empresa Demo",
      whatsapp: "5491100000000",
      mailComprobantes: "comprobantes@cliente.example",
    });
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toMatch(
      /^select "id", "name", "whatsapp_number", "receipts_email" from "public"\."tenants" where "public"\."tenants"\."id" = \$1/,
    );
    expect(consulta.params[0]).toBe("tenant-test");
  });

  it("con marca propia del sitio, el nombre es el de la marca y no el del tenant", async () => {
    marca = { nombre: "Tienda Demo", recursosCentral: false };
    grabadora = dbGrabadora(() => [["tenant-test", "Empresa Demo", "", ""]]);
    expect((await datosTenant())?.nombre).toBe("Tienda Demo");
  });

  it("sin WhatsApp ni mail cargados: null", async () => {
    grabadora = dbGrabadora(() => [["tenant-test", "Empresa Demo", "", " "]]);
    expect(await datosTenant()).toMatchObject({ whatsapp: null, mailComprobantes: null });
  });
});
