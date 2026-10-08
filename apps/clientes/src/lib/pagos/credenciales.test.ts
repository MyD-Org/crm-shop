import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { credencialesMercadoPago, credencialesPayway } from "./credenciales";

afterEach(() => vi.unstubAllEnvs());

describe("credencialesMercadoPago", () => {
  it("hoy devuelve el único juego del entorno, cuenta 'principal'", () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token-de-prueba");
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-clave-publica");
    vi.stubEnv("MP_WEBHOOK_SECRET", "secreto-de-prueba");
    expect(credencialesMercadoPago()).toEqual({
      cuentaId: "principal",
      accessToken: "TEST-token-de-prueba",
      publicKey: "TEST-clave-publica",
      webhookSecret: "secreto-de-prueba",
    });
  });

  it("la sucursal todavía no cambia la cuenta (preparado para cuentas por sucursal)", () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token-de-prueba");
    expect(credencialesMercadoPago({ sucursal: "mdp" })).toEqual(credencialesMercadoPago());
  });

  it("vacío o sólo espacios cuenta como ausente (null)", () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "  ");
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "");
    vi.stubEnv("MP_WEBHOOK_SECRET", "");
    const c = credencialesMercadoPago();
    expect(c.accessToken).toBeNull();
    expect(c.publicKey).toBeNull();
    expect(c.webhookSecret).toBeNull();
  });
});

describe("credencialesPayway", () => {
  it("hoy devuelve el único juego del entorno, cuenta 'principal'", () => {
    vi.stubEnv("PAYWAY_API_PRIVATE_KEY", "privada-de-prueba");
    vi.stubEnv("PAYWAY_API_PUBLIC_KEY", " publica-de-prueba ");
    vi.stubEnv("PAYWAY_BASE_URL", "https://payway.example");
    expect(credencialesPayway({ sucursal: "igz" })).toEqual({
      cuentaId: "principal",
      privateKey: "privada-de-prueba",
      publicKey: "publica-de-prueba",
      baseUrl: "https://payway.example",
    });
  });

  it("sin variables: todo null", () => {
    vi.stubEnv("PAYWAY_API_PRIVATE_KEY", "");
    vi.stubEnv("PAYWAY_API_PUBLIC_KEY", "");
    vi.stubEnv("PAYWAY_BASE_URL", "");
    expect(credencialesPayway()).toEqual({ cuentaId: "principal", privateKey: null, publicKey: null, baseUrl: null });
  });
});

/**
 * Guarda: las credenciales de los procesadores se leen SÓLO en el resolver. Mañana, con una cuenta de
 * Mercado Pago / Payway por sucursal, cambia el resolver y no los llamadores.
 */
describe("guarda: nadie más en lib/pagos lee las credenciales del entorno", () => {
  const dir = __dirname;
  const fuentes = readdirSync(dir).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "credenciales.ts",
  );
  it.each(fuentes)("%s", (archivo) => {
    const codigo = readFileSync(join(dir, archivo), "utf8");
    expect(codigo).not.toMatch(/process\.env\.(MP_|NEXT_PUBLIC_MP_|PAYWAY_)/);
  });
});
