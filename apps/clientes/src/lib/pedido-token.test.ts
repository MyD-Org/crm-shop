import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TTL_TOKEN_COMPRA_MS,
  acuñarTokenCompra,
  firmarToken,
  verificarToken,
} from "./pedido-token";

/**
 * Vector fijo: el firmante del CRM (apps/admin/src/lib/pedido-link.ts, rebanada S3b) tiene que
 * producir EXACTAMENTE el mismo token para la misma entrada. Si cambia el formato de un lado hay que
 * cambiarlo del otro; este archivo es el que lo detecta.
 */
const VECTOR = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/pedido-token-vector.json", import.meta.url)), "utf8"),
) as { secreto: string; tenant: string; proposito: "compra" | "pago"; orderId: string; venceEn: number; token: string };

const SECRETO = VECTOR.secreto;
const TENANT = VECTOR.tenant;
const PA = "11111111-1111-4111-8111-111111111111";
const PB = "22222222-2222-4222-8222-222222222222";
const AHORA = 1_800_000_000_000;

beforeEach(() => {
  vi.stubEnv("PEDIDO_LINK_SECRET", SECRETO);
  vi.stubEnv("SHOP_TENANT_ID", TENANT);
});
afterEach(() => vi.unstubAllEnvs());

const firmar = (p: Partial<Parameters<typeof firmarToken>[0]> = {}) =>
  firmarToken({ proposito: "compra", orderId: PA, venceEn: AHORA + 1000, ...p });

describe("vector compartido con el CRM", () => {
  it("firmar la entrada del vector da el token fijado", () => {
    expect(
      firmarToken({ proposito: VECTOR.proposito, orderId: VECTOR.orderId, venceEn: VECTOR.venceEn }),
    ).toBe(VECTOR.token);
  });
  it("y ese token verifica", () => {
    const r = verificarToken(VECTOR.token, VECTOR.proposito, VECTOR.venceEn - 1);
    expect(r).toEqual({ ok: true, orderId: VECTOR.orderId, venceEn: VECTOR.venceEn });
  });
});

describe("formato", () => {
  it("v1.<orderId>.<expBase36>.<firma>", () => {
    const t = firmar();
    const [v, id, exp, firma, ...resto] = t.split(".");
    expect(resto).toEqual([]);
    expect(v).toBe("v1");
    expect(id).toBe(PA);
    expect(parseInt(exp, 36)).toBe(AHORA + 1000);
    expect(firma).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("es determinista", () => {
    expect(firmar()).toBe(firmar());
  });
});

describe("verificarToken", () => {
  it("válido", () => {
    expect(verificarToken(firmar(), "compra", AHORA)).toEqual({ ok: true, orderId: PA, venceEn: AHORA + 1000 });
  });

  it("orderId alterado", () => {
    const t = firmar().replace(PA, PB);
    expect(verificarToken(t, "compra", AHORA)).toMatchObject({ ok: false, motivo: "firma" });
  });

  it("exp alterado (más largo, para extender la vida)", () => {
    const [v, id, , firma] = firmar().split(".");
    const t = [v, id, (AHORA + 10_000_000).toString(36), firma].join(".");
    expect(verificarToken(t, "compra", AHORA)).toMatchObject({ ok: false, motivo: "firma" });
  });

  it("exp alterado en un token ya vencido no lo revive", () => {
    const [v, id, , firma] = firmar({ venceEn: AHORA - 5 }).split(".");
    const t = [v, id, (AHORA + 10_000_000).toString(36), firma].join(".");
    expect(verificarToken(t, "compra", AHORA)).toMatchObject({ ok: false, motivo: "firma" });
  });

  it("firma truncada", () => {
    expect(verificarToken(firmar().slice(0, -1), "compra", AHORA)).toMatchObject({ ok: false });
  });

  it("firma extendida", () => {
    expect(verificarToken(firmar() + "A", "compra", AHORA)).toMatchObject({ ok: false });
  });

  it("firma de otro token del mismo pedido (otro exp)", () => {
    const otra = firmar({ venceEn: AHORA + 2000 }).split(".")[3];
    const [v, id, exp] = firmar().split(".");
    expect(verificarToken([v, id, exp, otra].join("."), "compra", AHORA)).toMatchObject({ ok: false, motivo: "firma" });
  });

  it("borde exacto de vencimiento: vigente hasta venceEn, vencido en venceEn", () => {
    const t = firmar({ venceEn: AHORA });
    expect(verificarToken(t, "compra", AHORA - 1)).toMatchObject({ ok: true });
    expect(verificarToken(t, "compra", AHORA)).toMatchObject({ ok: false, motivo: "vencido" });
    expect(verificarToken(t, "compra", AHORA + 1)).toMatchObject({ ok: false, motivo: "vencido" });
  });

  it("otro tenant", () => {
    const t = firmar();
    vi.stubEnv("SHOP_TENANT_ID", "otro-tenant.example");
    expect(verificarToken(t, "compra", AHORA)).toMatchObject({ ok: false, motivo: "firma" });
  });

  it("propósito cruzado compra <-> pago", () => {
    expect(verificarToken(firmar({ proposito: "pago" }), "compra", AHORA)).toMatchObject({
      ok: false,
      motivo: "proposito",
    });
    expect(verificarToken(firmar({ proposito: "compra" }), "pago", AHORA)).toMatchObject({
      ok: false,
      motivo: "proposito",
    });
  });

  it("el mismo orderId/exp firmado para cada propósito da firmas distintas", () => {
    expect(firmar({ proposito: "pago" })).not.toBe(firmar({ proposito: "compra" }));
  });

  it.each([
    "",
    "basura",
    "v1",
    "v1..",
    "v1.a.b.c.d",
    "v2." + PA + ".abc.firma",
    `v1.${PA}.${AHORA.toString(36)}.`,
    `v1.${PA}..AAAA`,
    `v1.no-es-uuid.${AHORA.toString(36)}.${"A".repeat(43)}`,
    `v1.${PA}.ZZZ!.${"A".repeat(43)}`,
    "\u0000\u0001",
  ])("formato basura %j", (t) => {
    expect(verificarToken(t, "compra", AHORA)).toMatchObject({ ok: false, motivo: "formato" });
  });

  it("tipos que no son string no explotan", () => {
    expect(verificarToken(undefined as unknown as string, "compra", AHORA)).toMatchObject({ ok: false });
    expect(verificarToken(null as unknown as string, "compra", AHORA)).toMatchObject({ ok: false });
    expect(verificarToken(42 as unknown as string, "compra", AHORA)).toMatchObject({ ok: false });
  });

  it("tokens larguísimos se rechazan sin trabajo", () => {
    expect(verificarToken("v1." + "a".repeat(10_000), "compra", AHORA)).toMatchObject({ ok: false, motivo: "formato" });
  });
});

describe("falla cerrada sin secreto", () => {
  it.each([undefined, "", "corto", "x".repeat(31)])("secreto %j: no firma", (s) => {
    vi.stubEnv("PEDIDO_LINK_SECRET", s as string);
    expect(() => firmar()).toThrow(/PEDIDO_LINK_SECRET/);
  });

  it.each([undefined, "", "corto", "x".repeat(31)])("secreto %j: no verifica (ni un token válido de antes)", (s) => {
    const t = firmar();
    vi.stubEnv("PEDIDO_LINK_SECRET", s as string);
    expect(verificarToken(t, "compra", AHORA)).toMatchObject({ ok: false, motivo: "secreto" });
  });

  it("32 caracteres alcanzan", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "x".repeat(32));
    expect(() => firmar()).not.toThrow();
  });

  it("sin SHOP_TENANT_ID falla (el Shop no opera sin tenant)", () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    expect(() => firmar()).toThrow(/SHOP_TENANT_ID/);
  });
});

describe("acuñarTokenCompra", () => {
  it("vence a las 6 h y es verificable como compra", () => {
    expect(TTL_TOKEN_COMPRA_MS).toBe(6 * 60 * 60_000);
    const { token, venceEn } = acuñarTokenCompra(PA, AHORA);
    expect(venceEn).toBe(AHORA + TTL_TOKEN_COMPRA_MS);
    expect(verificarToken(token, "compra", AHORA)).toMatchObject({ ok: true, orderId: PA });
    expect(verificarToken(token, "pago", AHORA)).toMatchObject({ ok: false });
  });
});

describe("comparación en tiempo constante", () => {
  it("usa secureCompare (no ===) para la firma", () => {
    const fuente = readFileSync(fileURLToPath(new URL("./pedido-token.ts", import.meta.url)), "utf8");
    expect(fuente).toMatch(/secureCompare\(/);
    expect(fuente).not.toMatch(/firma\s*===|===\s*firma|esperada\s*===|===\s*esperada/);
  });
});

describe("sin almacenamiento en el navegador (S1-4)", () => {
  it.each(["./pedido-token.ts", "./invitado-acceso.ts"])("%s no usa cookie ni storage", (archivo) => {
    const fuente = readFileSync(fileURLToPath(new URL(archivo, import.meta.url)), "utf8");
    expect(fuente).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB|cookies\(\)/);
  });
});
