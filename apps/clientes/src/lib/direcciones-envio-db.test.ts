import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbGrabadora,
  valoresInsertados,
  type ConsultaGrabada,
} from "@/db/__fixtures__/db-grabadora";
import type { DatosDireccion } from "./direcciones-envio";

/**
 * Forma de las consultas de direcciones de envío: TODA consulta a
 * `shop.direcciones_envio` lleva el tenant del entorno y el usuario de Clerk
 * (leer, crear, editar, borrar y marcar predeterminada). Se ejecutan las
 * funciones reales contra un cliente que graba el SQL.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  actualizarDireccion,
  crearDireccion,
  DireccionesLlenasError,
  eliminarDireccion,
  listarDirecciones,
  marcarPredeterminada,
} from "./direcciones-envio-db";

const ID = "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10";
const OTRO = "9d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

const datos = (extra: Partial<DatosDireccion> = {}): DatosDireccion => ({
  etiqueta: "Casa",
  calle: "Av. Victoria Aguirre 100",
  ciudad: "Puerto Iguazú",
  provincia: "Misiones",
  cp: "3370",
  referencias: null,
  predeterminada: false,
  ...extra,
});

/** Fila en el orden de las columnas que selecciona el módulo. */
const fila = (id = ID, predeterminada = true) => [
  id, "Casa", "Av. Victoria Aguirre 100", "Puerto Iguazú", "Misiones", "3370", null, predeterminada,
];

beforeEach(() => {
  grabadora = dbGrabadora();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Valor del parámetro que acompaña a `"direcciones_envio"."<columna>" = $n`. */
function paramDe(c: ConsultaGrabada, columna: string): unknown {
  const m = c.sql.match(new RegExp(`"direcciones_envio"\\."${columna}" = \\$(\\d+)`));
  expect(m, `${columna} en: ${c.sql}`).not.toBeNull();
  return c.params[Number(m![1]) - 1];
}

/** Tenant del entorno + usuario: la condición de TODA consulta. */
function esperaDueno(c: ConsultaGrabada, usuario = "u1", tenant = "tenant-a") {
  expect(c.sql).toContain('"shop"."direcciones_envio"');
  expect(paramDe(c, "tenant_id")).toBe(tenant);
  expect(paramDe(c, "clerk_user_id")).toBe(usuario);
}

const tipo = (c: ConsultaGrabada) => c.sql.split(" ")[0];

describe("listarDirecciones", () => {
  it("del usuario y del tenant: predeterminada primero, después la más nueva, con tope", async () => {
    grabadora = dbGrabadora(() => [fila(ID, true), fila(OTRO, false)]);
    const lista = await listarDirecciones("u1");
    expect(lista.map((d) => [d.id, d.predeterminada])).toEqual([
      [ID, true],
      [OTRO, false],
    ]);
    expect(lista[0]).toEqual({
      id: ID,
      etiqueta: "Casa",
      calle: "Av. Victoria Aguirre 100",
      ciudad: "Puerto Iguazú",
      provincia: "Misiones",
      cp: "3370",
      referencias: null,
      predeterminada: true,
    });
    const [c] = grabadora.consultas;
    esperaDueno(c);
    expect(c.sql).toMatch(
      /order by "shop"\."direcciones_envio"\."predeterminada" desc, "shop"\."direcciones_envio"\."created_at" desc/,
    );
    const m = c.sql.match(/ limit \$(\d+)/);
    expect(c.params[Number(m![1]) - 1]).toBe(10);
  });

  it("otro tenant, otro filtro; sin SHOP_TENANT_ID no consulta", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "tenant-b");
    await listarDirecciones("u2");
    esperaDueno(grabadora.consultas[0], "u2", "tenant-b");
    vi.stubEnv("SHOP_TENANT_ID", " ");
    await expect(listarDirecciones("u1")).rejects.toThrow(/SHOP_TENANT_ID/);
    expect(grabadora.consultas).toHaveLength(1);
  });
});

describe("crearDireccion", () => {
  it("la primera queda predeterminada sola, sin desmarcar nada", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith("select") ? [[0]] : c.sql.startsWith("insert") ? [fila(ID, true)] : undefined,
    );
    const d = await crearDireccion("u1", datos());
    expect(d.predeterminada).toBe(true);
    expect(grabadora.consultas.map(tipo)).toEqual(["select", "insert"]);
    esperaDueno(grabadora.consultas[0]);
    const v = valoresInsertados(grabadora.consultas[1]);
    expect(v).toMatchObject({
      tenant_id: "tenant-a",
      clerk_user_id: "u1",
      calle: "Av. Victoria Aguirre 100",
      ciudad: "Puerto Iguazú",
      provincia: "Misiones",
      cp: "3370",
      predeterminada: true,
    });
  });

  it("con otras guardadas no es predeterminada salvo que se pida", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith("select") ? [[3]] : c.sql.startsWith("insert") ? [fila(OTRO, false)] : undefined,
    );
    await crearDireccion("u1", datos());
    expect(grabadora.consultas.map(tipo)).toEqual(["select", "insert"]);
    expect(valoresInsertados(grabadora.consultas[1]).predeterminada).toBe(false);
  });

  it("pedida como predeterminada: primero desmarca la anterior del usuario", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith("select") ? [[3]] : c.sql.startsWith("insert") ? [fila(OTRO, true)] : undefined,
    );
    await crearDireccion("u1", datos({ predeterminada: true }));
    expect(grabadora.consultas.map(tipo)).toEqual(["select", "update", "insert"]);
    const desmarcar = grabadora.consultas[1];
    esperaDueno(desmarcar);
    expect(desmarcar.sql).toMatch(/set "predeterminada" = \$\d+/);
    expect(valoresInsertados(grabadora.consultas[2]).predeterminada).toBe(true);
  });

  it("en el tope de 10 lanza DireccionesLlenasError y no escribe", async () => {
    grabadora = dbGrabadora(() => [[10]]);
    await expect(crearDireccion("u1", datos())).rejects.toBeInstanceOf(DireccionesLlenasError);
    expect(grabadora.consultas.map(tipo)).toEqual(["select"]);
  });
});

describe("actualizarDireccion", () => {
  it("edita sólo si es del usuario y devuelve la fila", async () => {
    grabadora = dbGrabadora((c) => (c.sql.startsWith("update") ? [fila(ID, false)] : undefined));
    const d = await actualizarDireccion("u1", ID, datos({ calle: "San Martín 5" }));
    expect(d?.id).toBe(ID);
    expect(grabadora.consultas).toHaveLength(1);
    const [c] = grabadora.consultas;
    esperaDueno(c);
    expect(paramDe(c, "id")).toBe(ID);
    expect(c.params).toContain("San Martín 5");
    expect(c.sql).toContain('"updated_at" = ');
    // Editar no toca la marca de predeterminada salvo que se pida.
    expect(c.sql).not.toMatch(/"predeterminada" = \$/);
  });

  it("ajena o inexistente → null (la API responde 404)", async () => {
    expect(await actualizarDireccion("u1", ID, datos())).toBeNull();
    expect(grabadora.consultas).toHaveLength(1);
  });

  it("pedida como predeterminada: desmarca las otras y después marca ésta", async () => {
    grabadora = dbGrabadora((c) => (c.sql.startsWith("update") ? [fila(ID, false)] : undefined));
    const d = await actualizarDireccion("u1", ID, datos({ predeterminada: true }));
    expect(d?.predeterminada).toBe(true);
    expect(grabadora.consultas.map(tipo)).toEqual(["update", "update", "update"]);
    for (const c of grabadora.consultas) esperaDueno(c);
    expect(grabadora.consultas[2].sql).toMatch(/set "predeterminada" = \$\d+/);
    expect(paramDe(grabadora.consultas[2], "id")).toBe(ID);
  });
});

describe("eliminarDireccion", () => {
  it("borra sólo la del usuario; si no era la predeterminada no promueve nada", async () => {
    grabadora = dbGrabadora((c) => (c.sql.startsWith("delete") ? [[false]] : undefined));
    expect(await eliminarDireccion("u1", ID)).toBe(true);
    expect(grabadora.consultas.map(tipo)).toEqual(["delete"]);
    esperaDueno(grabadora.consultas[0]);
    expect(paramDe(grabadora.consultas[0], "id")).toBe(ID);
  });

  it("ajena o inexistente → false", async () => {
    expect(await eliminarDireccion("u1", ID)).toBe(false);
    expect(grabadora.consultas).toHaveLength(1);
  });

  it("borrar la predeterminada promueve la más reciente que queda", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith("delete") ? [[true]] : c.sql.startsWith("select") ? [[OTRO]] : undefined,
    );
    expect(await eliminarDireccion("u1", ID)).toBe(true);
    expect(grabadora.consultas.map(tipo)).toEqual(["delete", "select", "update"]);
    const [, buscar, promover] = grabadora.consultas;
    esperaDueno(buscar);
    expect(buscar.sql).toMatch(/order by "shop"\."direcciones_envio"\."created_at" desc/);
    esperaDueno(promover);
    expect(paramDe(promover, "id")).toBe(OTRO);
  });

  it("borrar la predeterminada y única no promueve nada", async () => {
    grabadora = dbGrabadora((c) => (c.sql.startsWith("delete") ? [[true]] : undefined));
    await eliminarDireccion("u1", ID);
    expect(grabadora.consultas.map(tipo)).toEqual(["delete", "select"]);
  });
});

describe("marcarPredeterminada", () => {
  it("comprueba que sea del usuario, desmarca las otras y marca ésta, en ese orden", async () => {
    grabadora = dbGrabadora((c) => (c.sql.startsWith("select") ? [[ID]] : undefined));
    expect(await marcarPredeterminada("u1", ID)).toBe(true);
    expect(grabadora.consultas.map(tipo)).toEqual(["select", "update", "update"]);
    for (const c of grabadora.consultas) esperaDueno(c);
    const [existe, desmarcar, marcar] = grabadora.consultas;
    expect(paramDe(existe, "id")).toBe(ID);
    expect(desmarcar.sql).toMatch(/"direcciones_envio"\."predeterminada" = \$\d+|"predeterminada"/);
    expect(paramDe(marcar, "id")).toBe(ID);
  });

  it("ajena o inexistente → false sin escribir", async () => {
    expect(await marcarPredeterminada("u1", ID)).toBe(false);
    expect(grabadora.consultas.map(tipo)).toEqual(["select"]);
  });
});
