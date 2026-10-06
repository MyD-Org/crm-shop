import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cargarBancoDeArgs, parsearArgs } from "./args";
import { BANCO } from "./banco";
import { hashBanco } from "./cargar-banco";

describe("parsearArgs: defaults (sin flags nuevos == comportamiento actual)", () => {
  it("v2, Jev grabado, umbral 85, vista actual, banco versionado", () => {
    const a = parsearArgs([]);
    expect(a).toMatchObject({
      tuberia: "v2",
      jev: "grabado",
      umbral: 85,
      produccion: false,
      etiquetas: "revisado",
      repeticiones: 1,
      calentar: 0,
      verConsultas: false,
      ver: 0,
      tenantAlias: "shop",
    });
    expect(a.banco).toBeUndefined();
    expect(a.json).toBeUndefined();
    expect(a.salida).toBeUndefined();
    expect(a.solo).toBeUndefined();
  });

  it("la tubería fase1 mantiene umbral 0", () => {
    expect(parsearArgs(["--tuberia=fase1"]).umbral).toBe(0);
  });

  it("las demás tuberías de medición no tienen umbral (0); un --umbral explícito manda", () => {
    expect(parsearArgs(["--tuberia=clasica"]).umbral).toBe(0);
    expect(parsearArgs(["--tuberia=tolerante"]).umbral).toBe(0);
    expect(parsearArgs(["--umbral=70"]).umbral).toBe(70);
  });

  it("flags legados: --salida, --solo=diagnostico, --ver", () => {
    const a = parsearArgs(["--umbral=70", "--salida=reporte.txt", "--solo=diagnostico", "--ver=3"]);
    expect(a).toMatchObject({ umbral: 70, salida: "reporte.txt", solo: "diagnostico", ver: 3 });
  });
});

describe("parsearArgs: --tuberia", () => {
  it.each(["clasica", "tolerante", "fase1", "v2", "motor"])("acepta %s", (t) => {
    expect(parsearArgs([`--tuberia=${t}`]).tuberia).toBe(t);
  });

  it("una tubería inválida falla enumerando los valores válidos", () => {
    expect(() => parsearArgs(["--tuberia=semantica"])).toThrow(/clasica\|tolerante\|fase1\|v2/);
  });
});

describe("parsearArgs: tubería motor (--politica, --superficie, --paridad, --paridad-con, --ids)", () => {
  it("--tuberia=motor: Jev como v2 (grabado por defecto), sin umbral, política cascada y superficie catálogo", () => {
    const a = parsearArgs(["--tuberia=motor"]);
    expect(a).toMatchObject({ tuberia: "motor", jev: "grabado", umbral: 0, politica: "cascada", superficie: "catalogo", paridad: false, ids: false });
    expect(parsearArgs(["--tuberia=motor", "--politica=legado"]).politica).toBe("legado");
    expect(a.paridadCon).toBeUndefined();
    expect(parsearArgs(["--tuberia=motor", "--jev=cache"]).jev).toBe("cache");
    expect(parsearArgs(["--tuberia=motor", "--jev=no"]).jev).toBe("no");
  });

  it("las demás tuberías no suman política ni superficie", () => {
    const a = parsearArgs([]);
    expect(a.politica).toBeUndefined();
    expect(a.superficie).toBeUndefined();
    expect(a.paridad).toBe(false);
  });

  it("--politica y --superficie: valores válidos y error enumerándolos", () => {
    expect(parsearArgs(["--tuberia=motor", "--politica=cascada", "--superficie=chat"])).toMatchObject({ politica: "cascada", superficie: "chat" });
    expect(parsearArgs(["--tuberia=motor", "--superficie=autocompletar"]).superficie).toBe("autocompletar");
    expect(() => parsearArgs(["--tuberia=motor", "--politica=otra"])).toThrow(/legado\|cascada/);
    expect(() => parsearArgs(["--tuberia=motor", "--superficie=admin"])).toThrow(/catalogo\|autocompletar\|chat/);
  });

  it("--politica y --superficie sólo valen con --tuberia=motor", () => {
    expect(() => parsearArgs(["--politica=legado"])).toThrow(/--tuberia=motor/);
    expect(() => parsearArgs(["--tuberia=v2", "--superficie=chat"])).toThrow(/--tuberia=motor/);
  });

  it("--paridad exige --tuberia=motor y política legado (que es su default)", () => {
    expect(parsearArgs(["--tuberia=motor", "--paridad"])).toMatchObject({ paridad: true, politica: "legado" });
    expect(() => parsearArgs(["--paridad"])).toThrow(/--tuberia=motor/);
    expect(() => parsearArgs(["--tuberia=motor", "--politica=cascada", "--paridad"])).toThrow(/legado/);
  });

  it("--paridad-con=<json> exige --tuberia=motor y fuerza --ids (la corrida actual los necesita)", () => {
    const a = parsearArgs(["--tuberia=motor", "--paridad-con=tmp/previa.json"]);
    expect(a).toMatchObject({ paridadCon: "tmp/previa.json", ids: true });
    expect(() => parsearArgs(["--paridad-con=tmp/previa.json"])).toThrow(/--tuberia=motor/);
  });

  it("--paridad y --paridad-con no se combinan", () => {
    expect(() => parsearArgs(["--tuberia=motor", "--paridad", "--paridad-con=x.json"])).toThrow(/--paridad/);
  });

  it("--ids se pide solo", () => {
    expect(parsearArgs(["--tuberia=motor", "--ids"]).ids).toBe(true);
    expect(parsearArgs(["--ids"]).ids).toBe(true);
  });
});

describe("parsearArgs: --jev", () => {
  it("grabado por defecto en v2; vivo sólo explícito", () => {
    expect(parsearArgs(["--tuberia=v2"]).jev).toBe("grabado");
    expect(parsearArgs(["--jev=vivo"]).jev).toBe("vivo");
    expect(parsearArgs(["--jev=no"]).jev).toBe("no");
    expect(parsearArgs(["--jev=cache"]).jev).toBe("cache");
  });

  it("un valor inválido falla enumerando los válidos", () => {
    expect(() => parsearArgs(["--jev=magico"])).toThrow(/grabado\|vivo\|no\|cache/);
  });

  it("clasica y tolerante ignoran --jev: 'no aplica'", () => {
    expect(parsearArgs(["--tuberia=clasica", "--jev=vivo"]).jev).toBe("no aplica");
    expect(parsearArgs(["--tuberia=tolerante"]).jev).toBe("no aplica");
  });

  it("fase1: --jev=no apaga Jev; --jev=vivo lo pide; grabado/cache no aplican", () => {
    expect(parsearArgs(["--tuberia=fase1", "--jev=no"]).jev).toBe("no");
    expect(parsearArgs(["--tuberia=fase1", "--jev=vivo"]).jev).toBe("vivo");
    expect(() => parsearArgs(["--tuberia=fase1", "--jev=grabado"])).toThrow(/fase1/);
    expect(() => parsearArgs(["--tuberia=fase1", "--jev=cache"])).toThrow(/fase1/);
  });

  it("fase1 sin --jev conserva el comportamiento de siempre (Jev si hay JEV_API_KEY, lo decide el llamador)", () => {
    const a = parsearArgs(["--tuberia=fase1"]);
    expect(a.jev).toBe("segun-entorno");
  });
});

describe("parsearArgs: --produccion", () => {
  it("sin --solo-visibles es un error", () => {
    expect(() => parsearArgs(["--produccion"])).toThrow(/--solo-visibles=si\|no/);
  });

  it("con --solo-visibles=si|no queda declarado", () => {
    expect(parsearArgs(["--produccion", "--solo-visibles=si"])).toMatchObject({ produccion: true, soloVisibles: true });
    expect(parsearArgs(["--produccion", "--solo-visibles=no"])).toMatchObject({ produccion: true, soloVisibles: false });
  });

  it("un valor que no es si|no falla", () => {
    expect(() => parsearArgs(["--produccion", "--solo-visibles=quizas"])).toThrow(/si\|no/);
  });

  it("--solo-visibles sin --produccion se ignora con aviso", () => {
    const a = parsearArgs(["--solo-visibles=si"]);
    expect(a.produccion).toBe(false);
    expect(a.avisos.join(" ")).toMatch(/--produccion/);
  });
});

describe("parsearArgs: otros flags", () => {
  it("--flags: pares nombre:on|off", () => {
    const a = parsearArgs(["--flags=busqueda-ia:on,catalogo-solo-visibles:off"]);
    expect(a.flags).toEqual({ "busqueda-ia": "on", "catalogo-solo-visibles": "off" });
    expect(() => parsearArgs(["--flags=busqueda-ia"])).toThrow(/--flags/);
    expect(() => parsearArgs(["--flags=busqueda-ia:tal"])).toThrow(/on\|off/);
  });

  it("--repeticiones y --calentar: enteros", () => {
    expect(parsearArgs(["--repeticiones=3", "--calentar=2"])).toMatchObject({ repeticiones: 3, calentar: 2 });
    expect(() => parsearArgs(["--repeticiones=0"])).toThrow(/repeticiones/);
    expect(() => parsearArgs(["--calentar=-1"])).toThrow(/calentar/);
    expect(() => parsearArgs(["--repeticiones=x"])).toThrow(/repeticiones/);
  });

  it("--etiquetas: revisado|todas", () => {
    expect(parsearArgs(["--etiquetas=todas"]).etiquetas).toBe("todas");
    expect(() => parsearArgs(["--etiquetas=otras"])).toThrow(/revisado\|todas/);
  });

  it("--json, --banco, --ver-consultas, --tenant-alias", () => {
    const a = parsearArgs(["--json=tmp/x.json", "--banco=tmp/b.local.json", "--ver-consultas", "--tenant-alias=demo"]);
    expect(a).toMatchObject({ json: "tmp/x.json", banco: "tmp/b.local.json", verConsultas: true, tenantAlias: "demo" });
  });

  it("--solo sólo admite diagnostico", () => {
    expect(() => parsearArgs(["--solo=otro"])).toThrow(/diagnostico/);
  });

  it("un flag desconocido falla (evita correr con defaults por un typo)", () => {
    expect(() => parsearArgs(["--tuberias=v2"])).toThrow(/desconocido/i);
  });
});

describe("cargarBancoDeArgs (sin tocar la base)", () => {
  it("sin --banco: el versionado, origen 'versionado', no local ni privado", () => {
    const { banco } = cargarBancoDeArgs(parsearArgs([]));
    expect(banco).toMatchObject({ origen: "versionado", local: false, privado: false, hash: hashBanco(BANCO) });
    expect(banco.casos).toHaveLength(BANCO.length);
  });

  it("--banco inexistente: error claro", () => {
    expect(() => cargarBancoDeArgs(parsearArgs(["--banco=/no/existe/banco.local.json"]))).toThrow(/no existe/i);
  });

  it("--banco inválido: error con índice y campo, sin el contenido", () => {
    const dir = mkdtempSync(join(tmpdir(), "banco-args-"));
    try {
      const ruta = join(dir, "malo.local.json");
      writeFileSync(ruta, JSON.stringify({ version: 1, busquedas: [{ perfil: "particular", categoria: ["cosa-privada"] }] }));
      try {
        cargarBancoDeArgs(parsearArgs([`--banco=${ruta}`]));
        throw new Error("debía fallar");
      } catch (e) {
        expect((e as Error).message).toMatch(/caso #0/);
        expect((e as Error).message).not.toContain("cosa-privada");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--banco válido: local y privado, sólo cuentan los revisados (por defecto) y se declaran los excluidos", () => {
    const dir = mkdtempSync(join(tmpdir(), "banco-args-"));
    try {
      const ruta = join(dir, "banco-real.local.json");
      const caso = (q: string, etiquetado?: string) => ({ q, perfil: "desconocido", debeIncluirEnTop24: ["x"], ...(etiquetado ? { etiquetado } : {}) });
      writeFileSync(ruta, JSON.stringify({ version: 1, origen: "real", busquedas: [caso("uno", "revisado"), caso("dos", "propuesto"), caso("tres", "descartado"), caso("cuatro")] }));
      const r = cargarBancoDeArgs(parsearArgs([`--banco=${ruta}`]));
      expect(r.banco).toMatchObject({ origen: "banco-real.local.json", local: true, privado: true, nRevisadas: 2 });
      expect(r.banco.casos.map((c) => c.q)).toEqual(["uno", "cuatro"]);
      expect(r.excluidos).toEqual({ pendiente: 0, propuesto: 1, descartado: 1 });
      const todas = cargarBancoDeArgs(parsearArgs([`--banco=${ruta}`, "--etiquetas=todas"]));
      expect(todas.banco.casos).toHaveLength(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--solo=diagnostico filtra los casos y el hash es el de los casos evaluados", () => {
    const { banco } = cargarBancoDeArgs(parsearArgs(["--solo=diagnostico"]));
    expect(banco.casos.every((c) => c.diagnostico)).toBe(true);
    expect(banco.casos.length).toBeGreaterThan(0);
    expect(banco.casos.length).toBeLessThan(BANCO.length);
    expect(banco.hash).toBe(hashBanco(banco.casos));
  });
});
