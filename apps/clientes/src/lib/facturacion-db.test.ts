import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbGrabadora,
  valoresInsertados,
  type ConsultaGrabada,
} from "@/db/__fixtures__/db-grabadora";

/**
 * `coincide_con_alegra` del perfil de facturación sale SÓLO del espejo de
 * contactos: 0 requests a Alegra, sin respaldo en vivo, y si el espejo falla el
 * perfil se guarda igual con null. Datos inventados.
 */

let espejo: unknown[][] | Error = [];
function responder(c: ConsultaGrabada): unknown[][] | undefined {
  if (c.sql.includes('"alegra_contacts_shop"')) {
    if (espejo instanceof Error) throw espejo;
    return espejo;
  }
  return [];
}
let grabadora = dbGrabadora(responder);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

const buscarContactoPorIdentificacion = vi.fn();
const getContacto = vi.fn();
vi.mock("./alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./alegra")>()),
  buscarContactoPorIdentificacion: (d: string) => buscarContactoPorIdentificacion(d),
  getContacto: (id: string) => getContacto(id),
}));

import { guardarPerfilFacturacion } from "./facturacion-db";

const DATOS = {
  pais: "AR" as const,
  tipoDoc: "CUIT" as const,
  nroDoc: "20-12345678-9",
  razonSocial: "Cliente Uno SA",
  condicionIva: "responsable_inscripto" as const,
};

const insertDelPerfil = () =>
  grabadora.consultas.find((c) => c.sql.startsWith('insert into "shop"."billing_profiles"'))!;

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  espejo = [];
  grabadora = dbGrabadora(responder);
  buscarContactoPorIdentificacion.mockReset();
  getContacto.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("guardarPerfilFacturacion → coincide_con_alegra", () => {
  it("documento en el espejo: guarda el id del contacto, 0 llamadas a Alegra", async () => {
    espejo = [["42", "Cliente Uno SA", "20-12345678-9", null, ["client"], null, null, null, "contado"]];
    await guardarPerfilFacturacion("user_1", DATOS);
    const consultaEspejo = grabadora.consultas.find((c) => c.sql.includes("alegra_contacts_shop"));
    expect(consultaEspejo?.params).toContain("20123456789");
    expect(valoresInsertados(insertDelPerfil())).toMatchObject({ coincide_con_alegra: "42" });
    expect(buscarContactoPorIdentificacion).not.toHaveBeenCalled();
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("sin fila en el espejo: null, sin respaldo en vivo", async () => {
    await guardarPerfilFacturacion("user_1", DATOS);
    expect(valoresInsertados(insertDelPerfil())).toMatchObject({ coincide_con_alegra: null });
    expect(buscarContactoPorIdentificacion).not.toHaveBeenCalled();
  });

  it("el espejo falla: el perfil se guarda igual con null", async () => {
    espejo = Object.assign(new Error("permission denied"), { code: "42501" });
    await guardarPerfilFacturacion("user_1", DATOS);
    expect(valoresInsertados(insertDelPerfil())).toMatchObject({ coincide_con_alegra: null });
    expect(buscarContactoPorIdentificacion).not.toHaveBeenCalled();
  });
});
