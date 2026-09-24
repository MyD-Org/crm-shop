import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { datosTenant } from "./tenant-cc";

beforeEach(() => {
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

  it("sin WhatsApp ni mail cargados: null", async () => {
    grabadora = dbGrabadora(() => [["tenant-test", "Empresa Demo", "", " "]]);
    expect(await datosTenant()).toMatchObject({ whatsapp: null, mailComprobantes: null });
  });
});
