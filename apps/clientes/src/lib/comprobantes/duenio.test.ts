import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@/db", () => ({ getDb: () => ({}) }));

import { duenioDe } from "./duenio";
import { condicionDuenio } from "./repo";

describe("duenioDe", () => {
  it("con cuenta corriente gana el código de cliente, aunque haya usuario de Clerk", () => {
    expect(duenioDe({ clerkUserId: "user_1", cliente: { codigocliente: "42" } })).toBe("42");
    expect(duenioDe({ clerkUserId: null, cliente: { codigocliente: "42" } })).toBe("42");
  });

  it("sin cuenta corriente es el usuario de Clerk", () => {
    expect(duenioDe({ clerkUserId: "user_1", cliente: null })).toEqual({ clerkUserId: "user_1" });
  });

  it("sin ninguna llave no hay dueño (nunca un filtro vacío)", () => {
    expect(duenioDe({ clerkUserId: null, cliente: null })).toBeNull();
    expect(duenioDe({ clerkUserId: "", cliente: { codigocliente: "" } })).toBeNull();
  });
});

describe("condicionDuenio", () => {
  const sql = (d: Parameters<typeof condicionDuenio>[1]) => {
    const q = new PgDialect().sqlToQuery(condicionDuenio("tenant-a", d)!);
    return { texto: q.sql, params: q.params };
  };

  it("código de cliente: filtra tenant y codigocliente", () => {
    const { texto, params } = sql("42");
    expect(texto).toContain('"payment_receipts"."tenant_id" = $1');
    expect(texto).toContain('"payment_receipts"."codigocliente" = $2');
    expect(texto).not.toContain("clerk_user_id");
    expect(params).toEqual(["tenant-a", "42"]);
  });

  it("sin cuenta corriente: filtra tenant y clerk_user_id", () => {
    const { texto, params } = sql({ clerkUserId: "user_1" });
    expect(texto).toContain('"payment_receipts"."clerk_user_id" = $2');
    expect(texto).not.toContain("codigocliente");
    expect(params).toEqual(["tenant-a", "user_1"]);
  });
});
