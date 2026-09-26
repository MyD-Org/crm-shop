import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Espejo de usuarios de Clerk (change `clientes-tienda-admin`, R1): mapeo del
 * UserJSON de Clerk y llamada a las funciones SQL de la 0018. La base es una
 * grabadora de SQL (las funciones se prueban contra Postgres real en
 * apps/admin/test/integration/shop-clientes-espejo.integration.test.ts).
 * Datos inventados.
 */

let resultado = "insertado";
function responder(c: ConsultaGrabada): unknown[][] | undefined {
  if (c.sql.includes("shop.clientes_")) return [{ resultado }] as unknown as unknown[][];
  return [];
}
let grabadora = dbGrabadora(responder);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  datosDeUsuarioClerk,
  eliminarUsuarioClerk,
  registrarUsuarioClerk,
  type UsuarioClerkJSON,
} from "./clientes-espejo";

const CREADO = Date.UTC(2026, 8, 1, 10);
const ACTUALIZADO = Date.UTC(2026, 8, 2, 10);

function usuario(over: Partial<UsuarioClerkJSON> = {}): UsuarioClerkJSON {
  return {
    id: "user_abc123",
    first_name: "Ana",
    last_name: "Pérez",
    primary_email_address_id: "idn_2",
    email_addresses: [
      { id: "idn_1", email_address: "otra@cliente.example" },
      { id: "idn_2", email_address: "ana@cliente.example" },
    ],
    created_at: CREADO,
    updated_at: ACTUALIZADO,
    ...over,
  } as UsuarioClerkJSON;
}

describe("datosDeUsuarioClerk", () => {
  it("toma el email PRIMARIO (no el primero), nombre y fechas en Date", () => {
    expect(datosDeUsuarioClerk(usuario())).toEqual({
      clerkUserId: "user_abc123",
      email: "ana@cliente.example",
      nombre: "Ana Pérez",
      creadoEn: new Date(CREADO),
      actualizadoEn: new Date(ACTUALIZADO),
    });
  });

  it("sin email primario (sólo teléfono) ⇒ email null", () => {
    expect(datosDeUsuarioClerk(usuario({ primary_email_address_id: null })).email).toBeNull();
    expect(
      datosDeUsuarioClerk(usuario({ primary_email_address_id: "idn_x" })).email,
    ).toBeNull();
    expect(
      datosDeUsuarioClerk(usuario({ email_addresses: undefined as never })).email,
    ).toBeNull();
  });

  it("nombre: trim de nombre + apellido; sin ninguno ⇒ null", () => {
    expect(datosDeUsuarioClerk(usuario({ first_name: "  Ana ", last_name: null })).nombre).toBe("Ana");
    expect(datosDeUsuarioClerk(usuario({ first_name: null, last_name: " Pérez" })).nombre).toBe("Pérez");
    expect(datosDeUsuarioClerk(usuario({ first_name: " ", last_name: null })).nombre).toBeNull();
  });

  it("recorta un nombre larguísimo a 200 y descarta un email de más de 254 (CHECK sc_largos)", () => {
    const d = datosDeUsuarioClerk(
      usuario({
        first_name: "A".repeat(300),
        email_addresses: [{ id: "idn_2", email_address: `${"a".repeat(250)}@cliente.example` }] as never,
      }),
    );
    expect(d.nombre).toHaveLength(200);
    expect(d.email).toBeNull();
  });

  it("created_at ausente ⇒ creadoEn null", () => {
    expect(datosDeUsuarioClerk(usuario({ created_at: undefined as never })).creadoEn).toBeNull();
  });
});

describe("registrarUsuarioClerk / eliminarUsuarioClerk", () => {
  beforeEach(() => {
    grabadora = dbGrabadora(responder);
    resultado = "insertado";
  });

  it("llama a shop.clientes_upsert_clerk con el tenant recibido y devuelve su resultado", async () => {
    resultado = "actualizado";
    const r = await registrarUsuarioClerk("tenant-x", datosDeUsuarioClerk(usuario()));
    expect(r).toBe("actualizado");
    expect(grabadora.consultas).toHaveLength(1);
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/select shop\.clientes_upsert_clerk\(/);
    expect(c.params.slice(0, 4)).toEqual(["tenant-x", "user_abc123", "ana@cliente.example", "Ana Pérez"]);
    // Las fechas viajan como ISO y se castean en SQL.
    expect(c.params.slice(4)).toEqual([new Date(CREADO).toISOString(), new Date(ACTUALIZADO).toISOString()]);
  });

  it("llama a shop.clientes_eliminar_clerk con tenant e id", async () => {
    resultado = "eliminado";
    expect(await eliminarUsuarioClerk("tenant-x", "user_abc123")).toBe("eliminado");
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/select shop\.clientes_eliminar_clerk\(/);
    expect(c.params).toEqual(["tenant-x", "user_abc123"]);
  });

  it("un error de base se propaga (el webhook responde 500 y Clerk reintenta)", async () => {
    grabadora = dbGrabadora(() => {
      throw new Error("conexión caída");
    });
    await expect(registrarUsuarioClerk("tenant-x", datosDeUsuarioClerk(usuario()))).rejects.toThrow();
  });
});
