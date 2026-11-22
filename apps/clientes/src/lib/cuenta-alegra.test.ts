import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUENTA_PRINCIPAL, credencialesAlegra, esCuentaPrincipal, shopCuentaAlegra } from "./cuenta-alegra";

afterEach(() => vi.unstubAllEnvs());

describe("shopCuentaAlegra", () => {
  it("sin la variable (o vacía) es la cuenta principal", () => {
    expect(CUENTA_PRINCIPAL).toBe("principal");
    expect(shopCuentaAlegra({})).toBe("principal");
    expect(shopCuentaAlegra({ SHOP_CUENTA_ALEGRA: "" })).toBe("principal");
    expect(shopCuentaAlegra({ SHOP_CUENTA_ALEGRA: "   " })).toBe("principal");
  });

  it("normaliza espacios al borde y mayúsculas", () => {
    expect(shopCuentaAlegra({ SHOP_CUENTA_ALEGRA: " MDP " })).toBe("mdp");
    expect(shopCuentaAlegra({ SHOP_CUENTA_ALEGRA: "mar-del-plata" })).toBe("mar-del-plata");
    expect(shopCuentaAlegra({ SHOP_CUENTA_ALEGRA: "Principal" })).toBe("principal");
  });

  it("un slug inválido corta (no se adivina la cuenta)", () => {
    for (const malo of ["m d p", "-mdp", "mdp_1", "mdp!", "a".repeat(41)]) {
      expect(() => shopCuentaAlegra({ SHOP_CUENTA_ALEGRA: malo })).toThrow(/SHOP_CUENTA_ALEGRA/);
    }
    expect(shopCuentaAlegra({ SHOP_CUENTA_ALEGRA: "a".repeat(40) })).toBe("a".repeat(40));
  });

  it("por defecto lee process.env en cada llamada", () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    expect(shopCuentaAlegra()).toBe("mdp");
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "");
    expect(shopCuentaAlegra()).toBe("principal");
  });
});

describe("esCuentaPrincipal", () => {
  it("sólo con la cuenta principal", () => {
    expect(esCuentaPrincipal({})).toBe(true);
    expect(esCuentaPrincipal({ SHOP_CUENTA_ALEGRA: "PRINCIPAL" })).toBe(true);
    expect(esCuentaPrincipal({ SHOP_CUENTA_ALEGRA: "mdp" })).toBe(false);
  });
});

describe("credencialesAlegra(cuenta)", () => {
  const env = {
    ALEGRA_EMAIL: "igz@cliente.example",
    ALEGRA_TOKEN: "token-igz",
    ALEGRA_EMAIL_MDP: "mdp@cliente.example",
    ALEGRA_TOKEN_MDP: "token-mdp",
    ALEGRA_EMAIL_MAR_DEL_PLATA: "mardel@cliente.example",
    ALEGRA_TOKEN_MAR_DEL_PLATA: "token-mardel",
  };

  it("principal usa las variables sin sufijo", () => {
    expect(credencialesAlegra("principal", env)).toEqual({
      cuenta: "principal",
      email: "igz@cliente.example",
      token: "token-igz",
    });
  });

  it("otra cuenta usa las variables con su sufijo", () => {
    expect(credencialesAlegra("mdp", env)).toEqual({
      cuenta: "mdp",
      email: "mdp@cliente.example",
      token: "token-mdp",
    });
  });

  it("slug con guion: guion bajo en la variable (misma regla que pagos)", () => {
    expect(credencialesAlegra("mar-del-plata", env).email).toBe("mardel@cliente.example");
  });

  it("por defecto lee process.env", () => {
    vi.stubEnv("ALEGRA_EMAIL_MDP", "mdp@cliente.example");
    vi.stubEnv("ALEGRA_TOKEN_MDP", "token-mdp");
    expect(credencialesAlegra("mdp").token).toBe("token-mdp");
  });

  it("fail-closed: una cuenta secundaria sin sus credenciales NUNCA cae a las de la principal", () => {
    const soloIgz = { ALEGRA_EMAIL: "igz@cliente.example", ALEGRA_TOKEN: "token-igz", ALEGRA_EMAIL_MDP: "mdp@cliente.example" };
    let error: unknown;
    try {
      credencialesAlegra("mdp", soloIgz);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const mensaje = (error as Error).message;
    expect(mensaje).toMatch(/ALEGRA_TOKEN_MDP/);
    for (const valor of Object.values(soloIgz)) expect(mensaje).not.toContain(valor);
  });

  it("vacío o sólo espacios cuenta como ausente", () => {
    expect(() => credencialesAlegra("mdp", { ALEGRA_EMAIL_MDP: " ", ALEGRA_TOKEN_MDP: "t" })).toThrow(/ALEGRA_EMAIL_MDP/);
    expect(() => credencialesAlegra("principal", { ALEGRA_EMAIL: "a@cliente.example", ALEGRA_TOKEN: "" })).toThrow(
      /ALEGRA_TOKEN/,
    );
  });

  it("la principal sin credenciales también corta, sin valores en el mensaje", () => {
    expect(() => credencialesAlegra("principal", {})).toThrow(/ALEGRA_EMAIL.*ALEGRA_TOKEN|ALEGRA_TOKEN.*ALEGRA_EMAIL/);
  });

  it("una cuenta con formato inválido corta antes de leer variables", () => {
    expect(() => credencialesAlegra("../mdp", env)).toThrow();
    expect(() => credencialesAlegra("", env)).toThrow();
  });

  it("paridad: las credenciales devueltas son siempre de la cuenta pedida", () => {
    for (const cuenta of ["principal", "mdp", "mar-del-plata"]) {
      expect(credencialesAlegra(cuenta, env).cuenta).toBe(cuenta);
    }
    expect(credencialesAlegra("principal", env).token).toBe("token-igz");
    expect(credencialesAlegra("mdp", env).token).toBe("token-mdp");
    expect(() => credencialesAlegra("otra", env)).toThrow(/ALEGRA_EMAIL_OTRA/);
  });
});

/**
 * Guarda. Las credenciales de Alegra se leen SÓLO en cuenta-alegra.ts: con una cuenta por despliegue,
 * leerlas en otro archivo es la forma de consultar un id de una cuenta con la credencial de otra.
 */
function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__fixtures__" ? [] : fuentes(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}
const SRC = join(__dirname, "..");
const archivos = fuentes(SRC).filter((f) => !f.endsWith(join("lib", "cuenta-alegra.ts")));
const casos = archivos.map((f) => [relative(SRC, f), f] as const);

describe("guarda: nadie fuera de cuenta-alegra.ts nombra las credenciales de Alegra", () => {
  it("recorre todo src (recursivo) y excluye los tests", () => {
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos.some((f) => f.endsWith(join("lib", "alegra.ts")))).toBe(true);
    expect(archivos.some((f) => f.endsWith(".test.ts"))).toBe(false);
  });

  it.each(casos)("%s", (_, archivo) => {
    const codigo = readFileSync(archivo, "utf8");
    expect(codigo).not.toMatch(/ALEGRA_EMAIL|ALEGRA_TOKEN/);
  });
});
