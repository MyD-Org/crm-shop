import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * Avisos de vencimiento (AVI-1, AVI-3): filtro por tenant del Shop + cliente,
 * sólo enviados y de tipos conocidos, una fila por canal agrupada en UN aviso,
 * contador de avisos (no filas) y marcado que sólo toca `read_at`.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { contarNoLeidos, listarAvisos, marcarLeidos } from "./avisos";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const AJENO = "99999999-9999-4999-8999-999999999999";

/** Fila en el orden del select de `listarAvisos`: id, factura, alegra, tipo, enviado, leído. */
const fila = (id: string, factura: string, alegra: string | null, type: string, sentAt: string, readAt: string | null) => [
  id,
  factura,
  alegra,
  type,
  sentAt,
  readAt,
];

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listarAvisos", () => {
  it("filtra por tenant del Shop, cliente, enviados y tipos conocidos; más recientes primero", async () => {
    grabadora = dbGrabadora(() => []);
    await listarAvisos("42");
    const [c] = grabadora.consultas;
    expect(c.sql).toContain('from "public"."notification_log"');
    expect(c.sql).toMatch(/"tenant_id" = \$\d/);
    expect(c.sql).toMatch(/"codigocliente" = \$\d/);
    expect(c.sql).toMatch(/"status" = \$\d/);
    expect(c.sql).toMatch(/order by "public"\."notification_log"\."sent_at" desc/);
    expect(c.params).toEqual(
      expect.arrayContaining(["tenant-test", "42", "sent", "before_due_%", "after_due_%", "conditions_changed", 100]),
    );
  });

  it("dos avisos (AVI-1): uno por vencer sin leer y uno vencido leído, con fecha en hora de Argentina", async () => {
    grabadora = dbGrabadora(() => [
      fila(U1, "987", "5001", "before_due_3", "2026-09-20 02:00:00+00", null),
      fila(U2, "950", "5002", "after_due_7", "2026-09-10 15:00:00+00", "2026-09-11 10:00:00+00"),
    ]);
    const avisos = await listarAvisos("42");
    expect(avisos).toEqual([
      {
        id: U1,
        ids: [U1],
        facturaId: "987",
        facturaAlegraId: "5001",
        type: "before_due_3",
        sentAt: "2026-09-20T02:00:00.000Z",
        // 02:00 UTC es todavía el 19 en Argentina.
        fecha: "19/09/2026",
        leido: false,
      },
      expect.objectContaining({ id: U2, type: "after_due_7", leido: true }),
    ]);
  });

  it("una fila por canal del mismo (factura, tipo) ⇒ UN aviso con todos sus ids; leído sólo si todas lo están", async () => {
    grabadora = dbGrabadora(() => [
      fila(U1, "987", null, "before_due_3", "2026-09-20 12:05:00+00", "2026-09-20 13:00:00+00"),
      fila(U2, "987", "5001", "before_due_3", "2026-09-20 12:00:00+00", null),
      fila(U3, "987", "5001", "after_due_1", "2026-09-24 12:00:00+00", null),
    ]);
    const avisos = await listarAvisos("42");
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toMatchObject({ id: U1, ids: [U1, U2], leido: false, facturaAlegraId: "5001" });
    expect(avisos[1]).toMatchObject({ id: U3, ids: [U3] });
  });

  it("respeta el límite de avisos", async () => {
    grabadora = dbGrabadora(() => [
      fila(U1, "1", null, "before_due_3", "2026-09-20 12:00:00+00", null),
      fila(U2, "2", null, "before_due_3", "2026-09-19 12:00:00+00", null),
    ]);
    expect(await listarAvisos("42", 1)).toHaveLength(1);
  });
});

describe("contarNoLeidos", () => {
  it("cuenta avisos distintos (factura, tipo) sin leer del cliente", async () => {
    grabadora = dbGrabadora(() => [[3]]);
    expect(await contarNoLeidos("42")).toBe(3);
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^select count\(distinct \("factura_id", "type"\)\) from "public"\."notification_log"/);
    expect(c.sql).toMatch(/"read_at" is null/);
    expect(c.params).toEqual(expect.arrayContaining(["tenant-test", "42", "sent"]));
  });

  it("sin filas ⇒ 0", async () => {
    grabadora = dbGrabadora(() => []);
    expect(await contarNoLeidos("43")).toBe(0);
  });
});

describe("marcarLeidos (AVI-3)", () => {
  it("sólo actualiza read_at, del tenant y del cliente, y sólo los ids pedidos", async () => {
    grabadora = dbGrabadora();
    await marcarLeidos("42", [U1, U2]);
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^update "public"\."notification_log" set "read_at" = \$1 where/);
    expect(c.sql).toMatch(/"tenant_id" = \$\d/);
    expect(c.sql).toMatch(/"codigocliente" = \$\d/);
    expect(c.sql).toMatch(/"read_at" is null/);
    expect(c.sql).toMatch(/"id" in \(\$\d+, \$\d+\)/);
    expect(c.params).toEqual(expect.arrayContaining(["tenant-test", "42", U1, U2]));
  });

  it("id ajeno: el filtro por cliente lo deja afuera (el UPDATE no puede tocar filas de otro)", async () => {
    grabadora = dbGrabadora();
    await marcarLeidos("42", [AJENO]);
    const [c] = grabadora.consultas;
    expect(c.params).toEqual(expect.arrayContaining(["42", AJENO]));
    expect(c.sql).toMatch(/"codigocliente" = \$\d/);
  });

  it("ids inválidos o vacíos: no consulta nada", async () => {
    grabadora = dbGrabadora();
    await marcarLeidos("42", ["1 or 1=1", "../x"]);
    await marcarLeidos("42", []);
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("sin ids: todos los no leídos del cliente", async () => {
    grabadora = dbGrabadora();
    await marcarLeidos("42");
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^update "public"\."notification_log" set "read_at" = \$1 where/);
    expect(c.sql).not.toMatch(/"id" in/);
    expect(c.params).toEqual(expect.arrayContaining(["tenant-test", "42"]));
  });
});
