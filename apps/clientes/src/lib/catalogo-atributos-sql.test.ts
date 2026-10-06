import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { atributoPorId, type CriterioEstructurado } from "./catalogo-atributos";
import {
  columnasConteoAtributos,
  contradiccionSql,
  contradiceAtributoSql,
  cumpleAtributoSql,
  filtroAtributosSql,
  sinContradiccionSql,
  tieneClaveSql,
  type ContextoAtributos,
} from "./catalogo-atributos-sql";

const dialecto = new PgDialect();
const render = (s: SQL) => dialecto.sqlToQuery(s);

/**
 * Contexto "del WHERE": con filas de `catalog_atributos` (lo arma catalog.ts). Acá se arma con la
 * misma pieza que usa catalog.ts (`contradiccionSql`) sobre columnas falsas, para que el test mire
 * el SQL real de la contradicción.
 */
const filaFalsa = (clave: string, extra?: SQL) =>
  sql`select 1 from FILAS where producto = P and clave = ${clave}${extra ? sql` and ${extra}` : sql``}`;
const ctxWhere = (extra: Partial<ContextoAtributos> = {}): ContextoAtributos => ({
  texto: sql`TEXTO`,
  existe: (c) => sql`exists (${filaFalsa(c.clave, sql`CUMPLE_FALSO(${c.clave})`)})`,
  contradice: (c) => sql`exists (${filaFalsa(c.clave, contradiccionSql(c, sql`VN`, sql`VT`))})`,
  tiene: (clave) => sql`exists (${filaFalsa(clave)})`,
  ...extra,
});
/** Contexto "de las facetas": el jsonb `{clave: {n, t}}` armado una vez por fila. */
const ctxFacetas: ContextoAtributos = { texto: sql`TEXTO`, attrs: sql`ATTRS` };
/** Sin datos estructurados (flag apagado o tabla sin migrar). */
const ctxSinEstructurados: ContextoAtributos = { texto: sql`TEXTO` };

const crit = (id: string): CriterioEstructurado => atributoPorId(id)!.estructurado!;

describe("contradiccionSql", () => {
  it("numérico: hay dato y NO cumple (coalesce a falso para que nunca sea NULL)", () => {
    const { sql: texto, params } = render(contradiccionSql(crit("corriente_a:20"), sql`VN`, sql`VT`));
    expect(texto).toContain("VN is not null");
    expect(texto).not.toContain("VT is not null");
    expect(texto).toContain("not coalesce(");
    expect(texto).toContain(", false)");
    expect(params).toEqual([20]);
  });

  it("de texto (zócalo): usa valor_texto", () => {
    const { sql: texto, params } = render(contradiccionSql(crit("zocalo:e14"), sql`VN`, sql`VT`));
    expect(texto).toContain("VT is not null");
    expect(texto).not.toContain("VN is not null");
    expect(params).toEqual(["e14"]);
  });

  it("tensión: el dato puede ser un número o un rango en texto", () => {
    const { sql: texto, params } = render(contradiccionSql(crit("tension_v:12"), sql`VN`, sql`VT`));
    expect(texto).toContain("VN is not null or VT is not null");
    expect(params).toContain(12);
  });
});

describe("sinContradiccionSql", () => {
  it("ruta existe: NOT EXISTS con la clave como parámetro y el valor en params", () => {
    const { sql: texto, params } = render(sinContradiccionSql(ctxWhere(), crit("corriente_a:20"))!);
    expect(texto.startsWith("not exists (")).toBe(true);
    expect(texto).toContain("clave = $1");
    expect(texto).toContain("not coalesce(");
    expect(params).toEqual(["corriente_a", 20]);
    expect(texto).not.toMatch(/\b20\b/);
  });

  it("ruta attrs (jsonb): el mismo resultado booleano, sin tocar la tabla", () => {
    const { sql: texto, params } = render(sinContradiccionSql(ctxFacetas, crit("corriente_a:20"))!);
    expect(texto.startsWith("not (")).toBe(true);
    expect(texto).toContain("(ATTRS -> 'corriente_a') ->> 'n'");
    expect(texto).toContain("is not null");
    expect(texto).toContain("not coalesce(");
    expect(params).toEqual([20]);
  });

  it("ruta attrs con un zócalo lee el texto del jsonb", () => {
    const { sql: texto, params } = render(sinContradiccionSql(ctxFacetas, crit("zocalo:e14"))!);
    expect(texto).toContain("->> 't')");
    expect(params).toEqual(["e14"]);
  });

  it("sin datos estructurados no restringe (undefined)", () => {
    expect(sinContradiccionSql(ctxSinEstructurados, crit("corriente_a:20"))).toBeUndefined();
  });
});

describe("tieneClaveSql", () => {
  it("existe: una fila de la clave con cualquier valor", () => {
    const { sql: texto, params } = render(tieneClaveSql(ctxWhere(), "polos")!);
    expect(texto).toContain("clave = $1");
    expect(params).toEqual(["polos"]);
  });

  it("attrs: la clave está en el jsonb", () => {
    const { sql: texto } = render(tieneClaveSql(ctxFacetas, "polos")!);
    expect(texto).toContain("(ATTRS -> 'polos') is not null");
  });

  it("sin datos estructurados: undefined", () => {
    expect(tieneClaveSql(ctxSinEstructurados, "polos")).toBeUndefined();
  });

  it("claves con dígitos (seccion_mm2) sí son válidas en el jsonb", () => {
    expect(render(tieneClaveSql(ctxFacetas, "seccion_mm2")!).sql).toContain("'seccion_mm2'");
    expect(render(sinContradiccionSql(ctxFacetas, crit("seccion_mm2:2.5"))!).sql).toContain("'seccion_mm2'");
  });

  it("una clave con formato raro nunca llega al SQL del jsonb", () => {
    expect(() => tieneClaveSql(ctxFacetas, "polos') or 1=1 --" as never)).toThrow();
  });
});

describe("filtroAtributosSql con ids dinámicos", () => {
  it("modo por defecto: sin contradicción; el valor viaja SOLO como parámetro (R4.2)", () => {
    const { sql: texto, params } = render(filtroAtributosSql(ctxWhere(), ["corriente_a:20"])!);
    expect(texto).toContain("not exists (");
    expect(params).toContain(20);
    expect(texto).not.toMatch(/\b20\b/);
    // Ni el patrón del texto: la contradicción mira solo el dato estructurado.
    expect(texto).not.toContain("~*");
  });

  it("modo positivo: el dato estructurado O el patrón del nombre", () => {
    const { sql: texto, params } = render(filtroAtributosSql(ctxWhere({ medidaPositiva: true }), ["corriente_a:20"])!);
    expect(texto).not.toContain("not exists");
    expect(texto).toContain("CUMPLE_FALSO($");
    expect(texto).toContain(" or TEXTO ~* ");
    expect(params.some((p) => typeof p === "string" && /\(\^\|\[\^0-9\.,\]\)20 \?\(a\|amp/.test(p))).toBe(true);
  });

  it("modo positivo sin patrón (polos): solo el dato, sin OR", () => {
    const { sql: texto } = render(filtroAtributosSql(ctxWhere({ medidaPositiva: true }), ["polos:2"])!);
    expect(texto).toContain("CUMPLE_FALSO($");
    expect(texto).not.toContain("~*");
    expect(texto).not.toContain(" or ");
  });

  it("OR dentro del mismo grupo (dos corrientes), AND entre grupos", () => {
    const { sql: texto, params } = render(filtroAtributosSql(ctxWhere(), ["corriente_a:20", "corriente_a:25", "polos:2"])!);
    expect(texto.match(/not exists/g)).toHaveLength(3);
    // ((no contradice corriente 20 o no contradice corriente 25) y no contradice polos 2)
    expect(texto).toMatch(/^\(\(not exists \([^]*\) or not exists \([^]*\)\) and not exists \([^]*\)\)$/);
    expect(params).toEqual(["corriente_a", 20, "corriente_a", 25, "polos", 2]);
  });

  it("mezcla con el diccionario: el id estático sigue como antes (patrón o estructurado)", () => {
    const { sql: texto } = render(filtroAtributosSql(ctxWhere(), ["zocalo-e27", "polos:2"])!);
    expect(texto).toContain("CUMPLE_FALSO($");
    expect(texto).toContain("TEXTO ~* ");
    expect(texto).toContain("not exists");
  });

  it("sin datos estructurados no restringe: sin SQL", () => {
    expect(filtroAtributosSql(ctxSinEstructurados, ["corriente_a:20"])).toBeUndefined();
    expect(filtroAtributosSql(ctxSinEstructurados, ["corriente_a:20"], undefined)).toBeUndefined();
  });

  it("ip: pedido o superior (desde), no igualdad", () => {
    const { params } = render(filtroAtributosSql(ctxWhere(), ["ip:65"])!);
    expect(params).toEqual(["ip", 65]);
    expect(crit("ip:65")).toEqual({ clave: "ip", desde: 65 });
    const { sql: texto } = render(contradiccionSql(crit("ip:65"), sql`VN`, sql`VT`));
    expect(texto).toContain("VN >= $1");
  });

  it("tensión: incluye el rango en texto (enRango)", () => {
    const { sql: texto, params } = render(filtroAtributosSql(ctxWhere(), ["tension_v:12"])!);
    expect(texto).toContain("not exists");
    expect(params).toContain(12);
  });

  it("banda: desde y hasta", () => {
    const { sql: texto, params } = render(filtroAtributosSql(ctxWhere(), ["potencia_w:8-10"])!);
    expect(texto).toContain("VN >= $");
    expect(texto).toContain("VN <= $");
    expect(params).toEqual(["potencia_w", 8, 10]);
  });

  it("inyección: un id inválido no llega al SQL", () => {
    expect(filtroAtributosSql(ctxWhere(), ["corriente_a:20' OR 1=1--", "polos:2;drop table x"])).toBeUndefined();
  });
});

describe("cumpleAtributoSql (el positivo del boost y de recuperar)", () => {
  it("dinámico: estructurado OR patrón", () => {
    const { sql: texto } = render(cumpleAtributoSql(ctxWhere(), "corriente_a:20")!);
    expect(texto).toContain("CUMPLE_FALSO($");
    expect(texto).toContain(" or TEXTO ~* ");
    expect(texto).not.toContain("not exists");
  });

  it("dinámico sin patrón (polos): solo el dato, sin OR", () => {
    const { sql: texto } = render(cumpleAtributoSql(ctxWhere(), "polos:2")!);
    expect(texto).toContain("CUMPLE_FALSO($");
    expect(texto).not.toContain("~*");
  });

  it("aunque el contexto sea el de no contradicción, el boost es positivo", () => {
    const { sql: texto } = render(cumpleAtributoSql(ctxWhere({ medidaPositiva: false }), "corriente_a:20")!);
    expect(texto).not.toContain("not exists");
  });

  it("sin datos estructurados: solo el patrón (la fase 1) y, sin patrón, nada", () => {
    const { sql: texto } = render(cumpleAtributoSql(ctxSinEstructurados, "corriente_a:20")!);
    expect(texto).toBe("TEXTO ~* $1");
    expect(cumpleAtributoSql(ctxSinEstructurados, "polos:2")).toBeUndefined();
  });

  it("estático: idéntico a filtrarlo", () => {
    const a = render(cumpleAtributoSql(ctxWhere(), "zocalo-e27")!);
    const b = render(filtroAtributosSql(ctxWhere(), ["zocalo-e27"])!);
    expect(a).toEqual(b);
  });

  it("id desconocido o inválido: undefined", () => {
    expect(cumpleAtributoSql(ctxWhere(), "desconocido")).toBeUndefined();
    expect(cumpleAtributoSql(ctxWhere(), "corriente_a:0")).toBeUndefined();
  });
});

describe("facetas con un id dinámico activo", () => {
  it("las otras facetas cuentan con la contradicción (jsonb) del dinámico y la propia del diccionario sigue igual", () => {
    const columnas = columnasConteoAtributos(ctxFacetas, ["corriente_a:20"]);
    const { sql: texto, params } = render(columnas["zocalo-e27"]);
    expect(texto).toContain("not (");
    expect(texto).toContain("(ATTRS -> 'corriente_a')");
    expect(params).toContain(20);
    // El diccionario no suma columnas para las medidas.
    expect(Object.keys(columnas).some((k) => k.includes(":"))).toBe(false);
  });

  it("con medidaPositiva las facetas cuentan solo lo que cumple", () => {
    const columnas = columnasConteoAtributos({ ...ctxFacetas, medidaPositiva: true }, ["corriente_a:20"]);
    const { sql: texto } = render(columnas["zocalo-e27"]);
    expect(texto).not.toContain("not (");
    expect(texto).toContain("TEXTO ~* ");
  });
});

describe("contradiceAtributoSql (el negativo del orden: tiene dato de la clave y es otro)", () => {
  it("dinámico en el WHERE: el EXISTS de la contradicción, con el valor como parámetro", () => {
    const { sql: texto, params } = render(contradiceAtributoSql(ctxWhere(), "corriente_a:20")!);
    expect(texto).toContain("exists (");
    expect(texto).toContain("VN is not null");
    expect(texto).not.toContain("not exists");
    expect(params).toContain(20);
  });

  it("de texto (zócalo) y del diccionario (zocalo-e27): lee el valor_texto", () => {
    expect(render(contradiceAtributoSql(ctxWhere(), "zocalo:e14")!).sql).toContain("VT is not null");
    expect(render(contradiceAtributoSql(ctxWhere(), "zocalo-e27")!).sql).toContain("VT is not null");
  });

  it("en las facetas usa el jsonb", () => {
    expect(render(contradiceAtributoSql(ctxFacetas, "polos:2")!).sql).toContain("ATTRS");
  });

  it("sin datos estructurados, sin criterio estructurado o con un id inexistente: undefined", () => {
    expect(contradiceAtributoSql(ctxSinEstructurados, "corriente_a:20")).toBeUndefined();
    expect(contradiceAtributoSql(ctxWhere(), "no-existe")).toBeUndefined();
    expect(contradiceAtributoSql(ctxWhere(), "corriente_a:99999")).toBeUndefined();
  });

  it("es la negación exacta de sin contradicción (misma pieza)", () => {
    const ctx = ctxWhere();
    const neg = render(sinContradiccionSql(ctx, crit("corriente_a:20"))!);
    const pos = render(contradiceAtributoSql(ctx, "corriente_a:20")!);
    expect(neg.sql).toBe(`not ${pos.sql}`);
    expect(neg.params).toEqual(pos.params);
  });
});
