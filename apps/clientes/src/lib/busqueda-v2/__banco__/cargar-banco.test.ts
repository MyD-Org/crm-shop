import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cargarBancoDeArchivo,
  filtrarEtiquetas,
  hashBanco,
  parsearBanco,
  validarBanco,
} from "./cargar-banco";
import { tipoDe } from "./modelo";
import ejemplo from "./banco-real.ejemplo.json";
import versionado from "./banco.json";

const caso = (p: Record<string, unknown> = {}) => ({ q: "consulta sintetica uno", perfil: "particular", intencion: "producto", debeIncluirEnTop24: ["algo"], ...p });
const archivo = (busquedas: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, origen: "real", busquedas, ...extra });

describe("parsearBanco", () => {
  it("acepta un banco válido y devuelve los casos", () => {
    const b = parsearBanco(archivo([caso(), caso({ q: "consulta sintetica dos", perfil: "desconocido", tipo: "typo", peso: 12 })]), { origen: "local" });
    expect(b.casos).toHaveLength(2);
    expect(b.casos[1]).toMatchObject({ perfil: "desconocido", tipo: "typo", peso: 12 });
    expect(b.origen).toBe("local");
  });

  it("un banco local o marcado real/privado es privado; el embebido no", () => {
    expect(parsearBanco(archivo([caso()]), { origen: "local" }).privado).toBe(true);
    expect(parsearBanco(archivo([caso()], { privado: true }), { origen: "embebido" }).privado).toBe(true);
    expect(parsearBanco({ version: 2, busquedas: [caso()] }, { origen: "embebido" }).privado).toBe(false);
  });

  it("caso sin q: error con índice y campo, sin imprimir contenido", () => {
    const secreto = "texto-que-no-debe-salir";
    const malo = { perfil: "particular", categoria: [secreto] };
    expect(() => parsearBanco(archivo([caso(), malo]), { origen: "local" })).toThrow(/caso #1[\s\S]*\bq\b/);
    try {
      parsearBanco(archivo([caso(), malo]), { origen: "local" });
    } catch (e) {
      expect((e as Error).message).not.toContain(secreto);
    }
  });

  it("categoría de tipo incorrecto: error con índice y campo, sin el valor", () => {
    const malo = caso({ q: "consulta que no debe aparecer", categoria: "no-es-lista" });
    try {
      parsearBanco(archivo([malo]), { origen: "local" });
      throw new Error("debía fallar");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toMatch(/caso #0/);
      expect(m).toMatch(/categoria/);
      expect(m).not.toContain("consulta que no debe aparecer");
      expect(m).not.toContain("no-es-lista");
    }
  });

  it("valida enumeraciones (perfil, intención, tipo, etiquetado) y el peso", () => {
    for (const malo of [{ perfil: "otro" }, { intencion: "x" }, { tipo: "y" }, { etiquetado: "z" }, { peso: -1 }]) {
      expect(() => parsearBanco(archivo([caso(malo)]), { origen: "local" })).toThrow(/caso #0/);
    }
  });

  it("junta todos los errores en un solo mensaje", () => {
    try {
      parsearBanco(archivo([{ perfil: "x" }, { q: 5 }]), { origen: "local" });
    } catch (e) {
      expect((e as Error).message).toMatch(/caso #0/);
      expect((e as Error).message).toMatch(/caso #1/);
    }
  });

  it("rechaza lo que no es un banco (sin lista de búsquedas)", () => {
    expect(() => parsearBanco({ version: 1 }, { origen: "local" })).toThrow(/busquedas/);
    expect(() => parsearBanco(null, { origen: "local" })).toThrow();
  });

  it("el banco versionado (banco.json) pasa por el mismo esquema", () => {
    const b = parsearBanco(versionado, { origen: "embebido" });
    expect(b.casos.length).toBe(versionado.busquedas.length);
  });
});

describe("hashBanco", () => {
  const a = [caso(), caso({ q: "consulta sintetica dos" })] as never[];

  it("es estable e invariante al orden de claves / formato", () => {
    const reordenado = a.map((c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).reverse())) as never[];
    expect(hashBanco(a)).toBe(hashBanco(reordenado));
    expect(hashBanco(a)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("cambia si cambia un caso o el orden", () => {
    const base = hashBanco(a);
    expect(hashBanco([a[0], { ...(a[1] as object), q: "otra" }] as never[])).not.toBe(base);
    expect(hashBanco([a[1], a[0]])).not.toBe(base);
  });
});

describe("filtrarEtiquetas", () => {
  const casos = parsearBanco(
    archivo([
      caso({ etiquetado: "revisado" }),
      caso({}),
      caso({ etiquetado: "propuesto" }),
      caso({ etiquetado: "pendiente" }),
      caso({ etiquetado: "descartado" }),
    ]),
    { origen: "local" },
  ).casos;

  it("revisado (default): sólo revisados y los que no tienen campo", () => {
    const r = filtrarEtiquetas(casos, "revisado");
    expect(r.casos).toHaveLength(2);
    expect(r.excluidos).toEqual({ pendiente: 1, propuesto: 1, descartado: 1 });
  });

  it("todas: no filtra", () => {
    expect(filtrarEtiquetas(casos, "todas").casos).toHaveLength(5);
  });
});

describe("validarBanco", () => {
  it("avisa con conteos (nunca con textos)", () => {
    const casos = parsearBanco(
      archivo([
        caso({ q: "lampara x", categoria: ["No existe"] }),
        { q: "sin expectativa alguna", perfil: "particular" },
        caso({ q: "contacto test@cliente.example" }),
        caso({ q: "1234567890 pedido" }),
      ]),
      { origen: "local" },
    ).casos;
    const v = validarBanco(casos, ["Lamparas"]);
    expect(v.categoriaFueraDelArbol).toBe(1);
    expect(v.sinExpectativa).toBe(1);
    expect(v.datoPersonal).toBe(2);
    const texto = v.avisos.join("\n");
    expect(texto).not.toContain("lampara x");
    expect(texto).not.toContain("cliente.example");
    expect(texto).not.toContain("No existe");
  });

  it("sin árbol de referencia no avisa por categoría", () => {
    const casos = parsearBanco(archivo([caso({ categoria: ["Cualquiera"] })]), { origen: "local" }).casos;
    expect(validarBanco(casos).categoriaFueraDelArbol).toBe(0);
  });

  it("un banco limpio no avisa nada", () => {
    const casos = parsearBanco(archivo([caso({ categoria: ["Lamparas"] })]), { origen: "local" }).casos;
    expect(validarBanco(casos, ["Lamparas"]).avisos).toEqual([]);
  });
});

describe("tipoDe sobre casos parseados", () => {
  it("se deriva si falta y respeta el explícito", () => {
    const [a, b] = parsearBanco(archivo([caso({ intencion: "necesidad" }), caso({ tipo: "typo" })]), { origen: "local" }).casos;
    expect(tipoDe(a)).toBe("necesidad");
    expect(tipoDe(b)).toBe("typo");
  });
});

describe("cargarBancoDeArchivo", () => {
  it("archivo inexistente: error claro", () => {
    expect(() => cargarBancoDeArchivo("/ruta/que/no/existe/banco.local.json")).toThrow(/no existe/i);
  });

  it("JSON roto: error sin volcar el contenido", () => {
    const dir = mkdtempSync(join(tmpdir(), "banco-"));
    try {
      const ruta = join(dir, "roto.local.json");
      writeFileSync(ruta, '{ "busquedas": [ {"q": "consulta-privada" ');
      try {
        cargarBancoDeArchivo(ruta);
        throw new Error("debía fallar");
      } catch (e) {
        expect((e as Error).message).toMatch(/JSON/);
        expect((e as Error).message).not.toContain("consulta-privada");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carga un archivo válido como banco local", () => {
    const dir = mkdtempSync(join(tmpdir(), "banco-"));
    try {
      const ruta = join(dir, "ok.local.json");
      writeFileSync(ruta, JSON.stringify(archivo([caso()])));
      const b = cargarBancoDeArchivo(ruta);
      expect(b.origen).toBe("local");
      expect(b.casos).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("banco-real.ejemplo.json (guarda de esquema, público)", () => {
  it("es válido, sintético y de 3 casos revisados", () => {
    const b = parsearBanco(ejemplo, { origen: "local" });
    expect(b.casos).toHaveLength(3);
    expect(b.casos.every((c) => c.etiquetado === "revisado")).toBe(true);
    expect(JSON.stringify(ejemplo)).not.toMatch(/@|\d{7,}/);
  });
});

describe("parsearBanco: expectativa `medidas` y `sinMedidasDe`", () => {
  const carga = (p: Record<string, unknown>) => parsearBanco(archivo([caso(p)]), { origen: "embebido" }).casos[0];
  const falla = (p: Record<string, unknown>) => () => parsearBanco(archivo([caso(), caso({ q: "otra consulta sintetica", ...p })]), { origen: "embebido" });

  it("acepta medidas con valor, con rango y con `dura`", () => {
    const c = carga({
      medidas: [
        { clave: "polos", valor: 2, dura: true },
        { clave: "corriente_a", valor: 20, dura: true },
        { clave: "zocalo", valor: "e27" },
        { clave: "potencia_w", min: 10, max: 20 },
        { clave: "potencia_w", max: 50 },
        { clave: "ip", valor: 65 },
      ],
    });
    expect(c.medidas).toHaveLength(6);
  });

  it("`medidas: []` es válido y se conserva distinto de ausente (negativo: el plan no debe producir ninguna)", () => {
    expect(carga({ medidas: [] }).medidas).toEqual([]);
    expect(carga({}).medidas).toBeUndefined();
  });

  it("acepta `sinMedidasDe` con claves del contrato", () => {
    expect(carga({ medidas: [{ clave: "seccion_mm2", valor: 2.5 }], sinMedidasDe: ["polos"] }).sinMedidasDe).toEqual(["polos"]);
  });

  it("clave fuera de atributos-claves.json: error con el índice del caso, campo y sin el valor", () => {
    try {
      falla({ medidas: [{ clave: "clave_inventada_xyz", valor: 2 }] })();
      throw new Error("debía fallar");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toMatch(/caso #1/);
      expect(m).toMatch(/medidas\[0\]\.clave/);
      expect(m).not.toContain("clave_inventada_xyz");
    }
  });

  it("valor fuera de rango, de vocabulario o de tipo", () => {
    for (const medidas of [
      [{ clave: "polos", valor: 5 }],
      [{ clave: "polos", valor: 2.5 }],
      [{ clave: "corriente_a", valor: 0 }],
      [{ clave: "corriente_a", valor: 7000 }],
      [{ clave: "temperatura_k", valor: 12000 }],
      [{ clave: "ip", valor: 70 }],
      [{ clave: "zocalo", valor: "e99" }],
      [{ clave: "curva", valor: "z" }],
      [{ clave: "corriente_a", valor: "20" }],
      [{ clave: "zocalo", valor: 27 }],
      [{ clave: "corriente_a", valor: Number.NaN }],
      [{ clave: "medidas_mm", valor: "600 por 600" }],
    ]) {
      expect(falla({ medidas }), JSON.stringify(medidas)).toThrow(/caso #1/);
    }
  });

  it("rango fuera de rango o invertido", () => {
    for (const medidas of [
      [{ clave: "potencia_w", min: 20, max: 10 }],
      [{ clave: "potencia_w", min: -1, max: 10 }],
      [{ clave: "potencia_w", min: 10, max: 1_000_000 }],
    ]) {
      expect(falla({ medidas }), JSON.stringify(medidas)).toThrow(/caso #1/);
    }
  });

  it("exactamente una forma: valor, o min/max (nunca las dos ni ninguna)", () => {
    for (const medidas of [[{ clave: "potencia_w" }], [{ clave: "potencia_w", valor: 9, min: 5 }], [{ clave: "potencia_w", valor: 9, max: 12 }]]) {
      expect(falla({ medidas }), JSON.stringify(medidas)).toThrow(/caso #1/);
    }
  });

  it("`dura` sólo en claves discretas y sólo con valor", () => {
    expect(falla({ medidas: [{ clave: "potencia_w", valor: 9, dura: true }] })).toThrow(/dura/);
    expect(falla({ medidas: [{ clave: "temperatura_k", valor: 4000, dura: true }] })).toThrow(/dura/);
    expect(falla({ medidas: [{ clave: "polos", min: 1, max: 2, dura: true }] })).toThrow(/dura/);
    expect(falla({ medidas: [{ clave: "polos", valor: 2, dura: "si" }] })).toThrow(/dura/);
  });

  it("tipos inválidos: medidas no es lista, elemento no es objeto, sinMedidasDe con clave desconocida", () => {
    expect(falla({ medidas: "polos" })).toThrow(/medidas/);
    expect(falla({ medidas: ["polos"] })).toThrow(/medidas\[0\]/);
    expect(falla({ sinMedidasDe: "polos" })).toThrow(/sinMedidasDe/);
    expect(falla({ sinMedidasDe: ["clave_inventada_xyz"] })).toThrow(/sinMedidasDe/);
  });

  it("un caso con medidas (aun vacías) tiene expectativa: no sale en el aviso de casos sin expectativa", () => {
    const sin = { q: "consulta sin nada", perfil: "particular" } as const;
    expect(validarBanco([sin]).sinExpectativa).toBe(1);
    expect(validarBanco([{ ...sin, medidas: [] }]).sinExpectativa).toBe(0);
    expect(validarBanco([{ ...sin, sinMedidasDe: ["polos"] }]).sinExpectativa).toBe(0);
  });

  it("los casos actuales del banco versionado siguen cargando sin cambios", () => {
    expect(() => parsearBanco(versionado, { origen: "embebido" })).not.toThrow();
  });
});
