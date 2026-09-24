import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

/**
 * Vinculación en tres pasos: verificar (muestra la cuenta, NO vincula ni
 * consume), confirmar (vincula) y cancelar (anula los códigos pendientes).
 *
 * La base es un doble en memoria: drizzle-orm se reemplaza por marcadores
 * planos para que el doble pueda leer el techo de intentos del WHERE.
 */

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => ({ and: c }),
  desc: (c: unknown) => c,
  eq: () => ({}),
  gte: () => ({}),
  isNull: () => ({}),
  lt: (_c: unknown, techo: number) => ({ techo }),
  sql: () => ({}),
}));

const estado = {
  otp: null as null | { id: string; alegraContactId: string; codeHash: string; expiresAt: Date; consumedAt: Date | null },
  intentos: 0,
  vinculos: [] as unknown[],
};

function techoDe(cond: unknown): number {
  const partes = (cond as { and?: unknown[] }).and ?? [];
  const t = partes.find((p) => typeof (p as { techo?: unknown }).techo === "number") as { techo: number } | undefined;
  return t?.techo ?? Infinity;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- doble de drizzle
const db: any = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => (estado.otp && !estado.otp.consumedAt ? [estado.otp] : []),
        }),
      }),
    }),
  }),
  update: () => ({
    set: (vals: { consumedAt?: Date }) => ({
      where: (cond: unknown) => {
        const hecho = (async () => {
          if (vals.consumedAt && estado.otp) estado.otp.consumedAt = vals.consumedAt;
        })();
        return Object.assign(hecho, {
          returning: async () => {
            if (!estado.otp || estado.otp.consumedAt || estado.intentos >= techoDe(cond)) return [];
            estado.intentos += 1;
            return [{ intentos: estado.intentos }];
          },
        });
      },
    }),
  }),
  insert: () => ({
    values: (v: unknown) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          estado.vinculos.push(v);
          return [{ id: "link_1" }];
        },
      }),
    }),
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
};

vi.mock("@/db", () => ({ getDb: () => db }));
vi.mock("@/db/schema", () => ({ clientLinks: {}, linkOtps: {} }));
const getContacto = vi.fn();
vi.mock("./alegra", () => ({
  buscarContactoPorIdentificacion: vi.fn(),
  buscarContactosPorEmail: vi.fn(),
  esCliente: vi.fn(),
  getContacto: (...a: unknown[]) => getContacto(...a),
  idPriceListUsable: () => null,
}));
vi.mock("./contactos-espejo", () => ({
  contactoPorDocumento: vi.fn(),
  contactosPorEmail: vi.fn(),
  vinculableDeAlegra: (c: { name?: string; identification?: string }) => ({ ...c, tipoCuenta: "contado" }),
  vinculablePorId: vi.fn(async () => null),
}));
vi.mock("./email", () => ({ enmascararEmail: vi.fn(), enviarEmail: vi.fn() }));
vi.mock("./rate-limit", () => ({ permitir: vi.fn() }));

import { cancelarVinculacion, confirmarVinculacion, verificarCodigo } from "./vinculacion";

const USUARIO = "user_1";
const hash = (codigo: string) => createHmac("sha256", "secreto-test").update(`${USUARIO}:${codigo}`).digest("hex");

beforeEach(() => {
  vi.stubEnv("OTP_SECRET", "secreto-test");
  estado.otp = {
    id: "otp_1",
    alegraContactId: "42",
    codeHash: hash("123456"),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  estado.intentos = 0;
  estado.vinculos = [];
  getContacto.mockReset();
  getContacto.mockResolvedValue({ id: "42", name: "Cliente Ejemplo SA", identification: "30712345679" });
});

describe("verificarCodigo", () => {
  it("código correcto: devuelve la cuenta sin vincular ni consumir el código", async () => {
    expect(await verificarCodigo(USUARIO, "123456")).toEqual({
      ok: true,
      razonSocial: "Cliente Ejemplo SA",
      documento: "30712345679",
    });
    expect(estado.vinculos).toHaveLength(0);
    expect(estado.otp?.consumedAt).toBeNull();
  });

  it("código incorrecto: no revela la cuenta", async () => {
    const r = await verificarCodigo(USUARIO, "000000");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Cliente Ejemplo");
    expect(getContacto).not.toHaveBeenCalled();
  });
});

describe("confirmarVinculacion", () => {
  it("después de verificar, vincula y consume el código", async () => {
    await verificarCodigo(USUARIO, "123456");
    const r = await confirmarVinculacion(USUARIO, "123456");
    expect(r).toMatchObject({ ok: true, alegraContactId: "42" });
    expect(estado.vinculos).toHaveLength(1);
    expect(estado.otp?.consumedAt).toBeInstanceOf(Date);
  });

  it("quien acertó en el último intento de verificar puede confirmar igual", async () => {
    for (let i = 0; i < 4; i++) expect((await verificarCodigo(USUARIO, "000000")).ok).toBe(false);
    expect((await verificarCodigo(USUARIO, "123456")).ok).toBe(true);
    expect((await confirmarVinculacion(USUARIO, "123456")).ok).toBe(true);
  });
});

describe("cancelarVinculacion", () => {
  it("anula el código: después no sirve para vincular", async () => {
    await verificarCodigo(USUARIO, "123456");
    await cancelarVinculacion(USUARIO);
    const r = await confirmarVinculacion(USUARIO, "123456");
    expect(r.ok).toBe(false);
    expect(estado.vinculos).toHaveLength(0);
  });
});
