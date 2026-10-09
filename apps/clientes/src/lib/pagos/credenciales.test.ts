import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  credencialesMercadoPago,
  credencialesPayway,
  cuentaConfigurada,
  cuentasConSecreto,
  cuentasConfiguradas,
  hayCuentaConfigurada,
  paywayBaseUrl,
  paywayParaCsp,
} from "./credenciales";

afterEach(() => vi.unstubAllEnvs());

describe("credencialesMercadoPago(cuenta)", () => {
  it("lee sólo las variables con el sufijo de la cuenta", () => {
    const env = {
      MP_ACCESS_TOKEN_MDP: "TEST-token-mdp",
      MP_PUBLIC_KEY_MDP: "TEST-publica-mdp",
      MP_WEBHOOK_SECRET_MDP: "secreto-mdp",
      MP_ACCESS_TOKEN_IGZ: "TEST-token-igz",
    };
    expect(credencialesMercadoPago("mdp", env)).toEqual({
      cuentaId: "mdp",
      accessToken: "TEST-token-mdp",
      publicKey: "TEST-publica-mdp",
      webhookSecret: "secreto-mdp",
    });
    expect(credencialesMercadoPago("igz", env).accessToken).toBe("TEST-token-igz");
  });

  it("por defecto lee process.env", () => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
    expect(credencialesMercadoPago("igz").accessToken).toBe("TEST-token-igz");
  });

  it("ignora las variables sin sufijo y la pública del navegador", () => {
    const env = {
      MP_ACCESS_TOKEN: "TEST-token-viejo",
      NEXT_PUBLIC_MP_PUBLIC_KEY: "TEST-publica-vieja",
      MP_PUBLIC_KEY: "TEST-publica-sin-sufijo",
      MP_WEBHOOK_SECRET: "secreto-viejo",
    };
    expect(credencialesMercadoPago("igz", env)).toEqual({
      cuentaId: "igz",
      accessToken: null,
      publicKey: null,
      webhookSecret: null,
    });
    expect(cuentaConfigurada("mercadopago", "igz", env)).toBe(false);
    expect(hayCuentaConfigurada("mercadopago", env)).toBe(false);
  });

  it("vacío o sólo espacios cuenta como ausente", () => {
    const env = { MP_ACCESS_TOKEN_IGZ: "  ", MP_PUBLIC_KEY_IGZ: "", MP_WEBHOOK_SECRET_IGZ: " " };
    const c = credencialesMercadoPago("igz", env);
    expect(c.accessToken).toBeNull();
    expect(c.publicKey).toBeNull();
    expect(c.webhookSecret).toBeNull();
  });

  it("slug con guion: guion bajo en la variable", () => {
    expect(credencialesMercadoPago("mar-del-plata", { MP_ACCESS_TOKEN_MAR_DEL_PLATA: "TEST-t" }).accessToken).toBe("TEST-t");
  });

  it("la cuenta es obligatoria (error de tipos si se omite)", () => {
    // @ts-expect-error: sin cuenta no hay credenciales.
    expect(() => credencialesMercadoPago()).toThrow();
  });
});

describe("credencialesPayway(cuenta)", () => {
  const base = "https://payway.example/api/v2/";

  it("lee las keys con sufijo y la base compartida (normalizada, sin /api/v2)", () => {
    const env = {
      PAYWAY_API_PRIVATE_KEY_MDP: "privada-mdp",
      PAYWAY_API_PUBLIC_KEY_MDP: " publica-mdp ",
      PAYWAY_BASE_URL: base,
    };
    expect(credencialesPayway("mdp", env)).toEqual({
      cuentaId: "mdp",
      privateKey: "privada-mdp",
      publicKey: "publica-mdp",
      baseUrl: "https://payway.example",
    });
  });

  it("slug con guion", () => {
    const env = { PAYWAY_API_PRIVATE_KEY_MAR_DEL_PLATA: "privada" };
    expect(credencialesPayway("mar-del-plata", env).privateKey).toBe("privada");
  });

  it("ignora las keys sin sufijo", () => {
    const env = { PAYWAY_API_PRIVATE_KEY: "privada", PAYWAY_API_PUBLIC_KEY: "publica", PAYWAY_BASE_URL: base };
    expect(credencialesPayway("igz", env)).toEqual({
      cuentaId: "igz",
      privateKey: null,
      publicKey: null,
      baseUrl: "https://payway.example",
    });
    expect(hayCuentaConfigurada("payway", env)).toBe(false);
  });

  it("la cuenta es obligatoria (error de tipos si se omite)", () => {
    // @ts-expect-error: sin cuenta no hay credenciales.
    expect(() => credencialesPayway()).toThrow();
  });
});

describe("paywayBaseUrl", () => {
  it("sólo https; sin barra final ni /api/v2", () => {
    expect(paywayBaseUrl({ PAYWAY_BASE_URL: "https://payway.example/api/v2" })).toBe("https://payway.example");
    expect(paywayBaseUrl({ PAYWAY_BASE_URL: "https://payway.example/sub/" })).toBe("https://payway.example/sub");
    expect(paywayBaseUrl({ PAYWAY_BASE_URL: "http://payway.example" })).toBeNull();
    expect(paywayBaseUrl({ PAYWAY_BASE_URL: "no es una url" })).toBeNull();
    expect(paywayBaseUrl({})).toBeNull();
  });
});

describe("cuentas configuradas", () => {
  const env = {
    MP_ACCESS_TOKEN_IGZ: "TEST-t-igz",
    MP_PUBLIC_KEY_IGZ: "TEST-p-igz",
    MP_ACCESS_TOKEN_MDP: "TEST-t-mdp", // sin public key: incompleta
    MP_WEBHOOK_SECRET_MDP: "s-mdp",
    MP_WEBHOOK_SECRET_IGZ: "s-igz",
    PAYWAY_API_PRIVATE_KEY_MDP: "priv",
    PAYWAY_API_PUBLIC_KEY_MDP: "pub",
    PAYWAY_BASE_URL: "https://payway.example",
  };

  it("cuentaConfigurada: MP = token + public key; Payway = privada + pública + base https", () => {
    expect(cuentaConfigurada("mercadopago", "igz", env)).toBe(true);
    expect(cuentaConfigurada("mercadopago", "mdp", env)).toBe(false);
    expect(cuentaConfigurada("payway", "mdp", env)).toBe(true);
    expect(cuentaConfigurada("payway", "mdp", { ...env, PAYWAY_BASE_URL: "http://payway.example" })).toBe(false);
    expect(cuentaConfigurada("payway", "igz", env)).toBe(false);
    expect(cuentaConfigurada("desconocido", "igz", env)).toBe(false);
  });

  it("hayCuentaConfigurada: alcanza con una cuenta completa", () => {
    expect(hayCuentaConfigurada("mercadopago", env)).toBe(true);
    expect(hayCuentaConfigurada("payway", env)).toBe(true);
    expect(hayCuentaConfigurada("mercadopago", { MP_ACCESS_TOKEN_MDP: "t" })).toBe(false);
    expect(hayCuentaConfigurada("payway", { PAYWAY_API_PRIVATE_KEY_MDP: "a", PAYWAY_API_PUBLIC_KEY_MDP: "b" })).toBe(false);
    expect(hayCuentaConfigurada("desconocido", env)).toBe(false);
    expect(hayCuentaConfigurada("mercadopago", {})).toBe(false);
  });

  it("cuentasConfiguradas filtra los slugs conocidos con el juego completo", () => {
    expect(cuentasConfiguradas("mercadopago", ["mdp", "igz", "otra"], env)).toEqual(["igz"]);
    expect(cuentasConfiguradas("payway", ["mdp", "igz"], env)).toEqual(["mdp"]);
  });

  it("cuentasConSecreto: las que tienen el secreto del webhook de Mercado Pago", () => {
    expect(cuentasConSecreto("mercadopago", ["mdp", "igz", "otra"], env)).toEqual(["mdp", "igz"]);
    expect(cuentasConSecreto("mercadopago", ["mdp"], {})).toEqual([]);
  });

  it("paywayParaCsp: el origen de la base sólo si hay alguna cuenta Payway", () => {
    expect(paywayParaCsp(env)).toEqual({ origen: "https://payway.example" });
    expect(paywayParaCsp({ PAYWAY_BASE_URL: "https://payway.example/api/v2" })).toBeNull();
    expect(
      paywayParaCsp({ PAYWAY_API_PRIVATE_KEY_IGZ: "a", PAYWAY_API_PUBLIC_KEY_IGZ: "b", PAYWAY_BASE_URL: "https://payway.example/api/v2" }),
    ).toEqual({ origen: "https://payway.example" });
  });
});

/**
 * Guardas. Las credenciales de los procesadores se leen SÓLO acá: con una cuenta por sucursal, leerlas
 * en otro archivo es la forma de cobrar con la cuenta equivocada.
 */
function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__fixtures__" ? [] : fuentes(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}
const SRC = join(__dirname, "..", "..");
const archivos = fuentes(SRC).filter((f) => !f.endsWith(join("lib", "pagos", "credenciales.ts")));
const casos = archivos.map((f) => [relative(SRC, f), f] as const);

describe("guarda 1: nadie fuera de credenciales.ts nombra las variables de los procesadores", () => {
  it("recorre todo src (recursivo)", () => {
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos.some((f) => f.endsWith("headers-seguridad.ts"))).toBe(true);
  });

  it.each(casos)("%s", (_, archivo) => {
    const codigo = readFileSync(archivo, "utf8");
    expect(codigo).not.toMatch(/MP_ACCESS_TOKEN|MP_PUBLIC_KEY|MP_WEBHOOK_SECRET|PAYWAY_API_|PAYWAY_BASE_URL|NEXT_PUBLIC_MP_/);
    expect(codigo).not.toMatch(/process\.env\[\s*[`'"](MP_|PAYWAY_|NEXT_PUBLIC_MP_)/);
  });
});

describe("guarda 2: ninguna llamada omite la cuenta", () => {
  it.each(casos)("%s", (_, archivo) => {
    const codigo = readFileSync(archivo, "utf8");
    expect(codigo).not.toMatch(/credenciales(MercadoPago|Payway)\(\s*\)/);
    expect(codigo).not.toMatch(/credenciales\w+\(\s*\{/);
    // `proveedorPago(id)` con un solo argumento (la cuenta es el segundo).
    expect(codigo).not.toMatch(/proveedorPago\(\s*[^,()]+\)/);
  });
});
