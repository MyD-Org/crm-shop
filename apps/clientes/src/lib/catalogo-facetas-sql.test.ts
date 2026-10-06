import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  clavesActivas,
  columnasCumpleSql,
  condicionesPorClave,
  consultaFacetasPorTipoSql,
  entradaDeFilas,
  filtroCaracteristicasSql,
  type ContextoCar,
} from "./catalogo-facetas-sql";
import { REGISTRO } from "./catalogo-facetas-registro";

const dialecto = new PgDialect();
const render = (s: SQL) => dialecto.sqlToQuery(s);

/** Contexto falso: el `exists` real lo arma catalog.ts con `filaAtributoSql` (la PK de catalog_atributos). */
const ctx: ContextoCar = {
  num: sql`VN`,
  texto: sql`VT`,
  existe: (clave, condicion) => sql`exists (select 1 from FILAS where clave = ${clave} and ${condicion})`,
};

describe("condicionesPorClave", () => {
  it("lista numérica: igualdad sobre valor_num con el número como parámetro", () => {
    const m = condicionesPorClave(ctx, ["polos:2"]);
    expect([...m.keys()]).toEqual(["polos"]);
    const { sql: texto, params } = render(m.get("polos")!);
    expect(texto).toContain("VN in (");
    expect(texto).not.toContain("VT");
    expect(params).toEqual([2]);
  });

  it("lista de texto: igualdad sobre valor_texto", () => {
    const { sql: texto, params } = render(condicionesPorClave(ctx, ["curva:c"]).get("curva")!);
    expect(texto).toContain("VT in (");
    expect(params).toEqual(["c"]);
  });

  it("OR dentro de la clave: dos valores en un solo in (...)", () => {
    const { sql: texto, params } = render(condicionesPorClave(ctx, ["polos:2", "polos:4"]).get("polos")!);
    expect(texto).toMatch(/VN in \(\$1, \$2\)/);
    expect(params).toEqual([2, 4]);
  });

  it("rango: >= y <= sobre valor_num", () => {
    const { sql: texto, params } = render(condicionesPorClave(ctx, ["flujo_lm:800-1200"]).get("flujo_lm")!);
    expect(texto).toContain("VN >= $1");
    expect(texto).toContain("VN <= $2");
    expect(params).toEqual([800, 1200]);
  });

  it("dos rangos de la misma clave: OR", () => {
    const { sql: texto } = render(condicionesPorClave(ctx, ["largo_m:1-5", "largo_m:10-20"]).get("largo_m")!);
    expect(texto).toContain(" or ");
  });

  it("ids inválidos se descartan (clave desconocida, potencia por car, inyección)", () => {
    expect(condicionesPorClave(ctx, ["desconocida:1", "potencia_w:1-10", "polos:2;drop", "polos:99"]).size).toBe(0);
  });

  it("la potencia entra como clave potencia_w (parámetros propios), con uno o los dos extremos", () => {
    const m = condicionesPorClave(ctx, ["polos:2"], { min: 10 });
    expect([...m.keys()]).toEqual(["potencia_w", "polos"]);
    const { sql: texto, params } = render(m.get("potencia_w")!);
    expect(texto).toContain("VN >= $1");
    expect(texto).not.toContain("<=");
    expect(params).toEqual([10]);
    expect(condicionesPorClave(ctx, [], {}).size).toBe(0);
  });
});

describe("clavesActivas", () => {
  it("las claves con car (sin repetir) y potencia_w si hay rango de potencia, en orden del registro", () => {
    expect(clavesActivas(["curva:c", "polos:2", "polos:4"])).toEqual(["polos", "curva"]);
    expect(clavesActivas(["curva:c"], { max: 50 })).toEqual(["potencia_w", "curva"]);
    expect(clavesActivas(["nada:1"])).toEqual([]);
  });
});

describe("filtroCaracteristicasSql", () => {
  it("sin ids válidos no filtra", () => {
    expect(filtroCaracteristicasSql(ctx, undefined)).toBeUndefined();
    expect(filtroCaracteristicasSql(ctx, [])).toBeUndefined();
    expect(filtroCaracteristicasSql(ctx, ["desconocida:1"])).toBeUndefined();
  });

  it("un exists por clave (estricto: sin dato no pasa), AND entre claves", () => {
    const { sql: texto, params } = render(filtroCaracteristicasSql(ctx, ["polos:2", "polos:4", "curva:c"])!);
    expect(texto.match(/exists \(/g)).toHaveLength(2);
    expect(texto).toContain(" and ");
    expect(texto).not.toContain("not exists");
    // La clave viaja como parámetro (la valida el registro): nada interpolado.
    expect(params).toEqual(["polos", 2, 4, "curva", "c"]);
  });

  it("excluirClave deja afuera el filtro de esa clave", () => {
    const { params } = render(filtroCaracteristicasSql(ctx, ["polos:2", "curva:c"], "polos")!);
    expect(params).toEqual(["curva", "c"]);
    expect(filtroCaracteristicasSql(ctx, ["polos:2"], "polos")).toBeUndefined();
  });

  it("la potencia no viaja por car: el filtro de potencia sigue siendo potencia_min/max", () => {
    expect(filtroCaracteristicasSql(ctx, ["potencia_w:10-50"])).toBeUndefined();
  });
});

describe("columnasCumpleSql", () => {
  it("una columna booleana c0..cn por clave activa, en orden", () => {
    const cols = columnasCumpleSql(ctx, condicionesPorClave(ctx, ["polos:2", "curva:c"]));
    expect(Object.keys(cols)).toEqual(["c0", "c1"]);
    expect(render(cols.c0).params).toEqual(["polos", 2]);
    expect(render(cols.c1).params).toEqual(["curva", "c"]);
  });
});

describe("consultaFacetasPorTipoSql", () => {
  const base = sql`select ID as "id" from CATALOGO where W0`;

  it("sin car: una sola pasada, sin fallas, con el registro como VALUES y el tenant como parámetro", () => {
    const { sql: texto, params } = render(consultaFacetasPorTipoSql({ base, activas: [], tenant: "t-1" }));
    expect(texto).toContain("with base as (select ID");
    expect(texto).toContain("filas as materialized");
    expect(texto).toContain('"public"."catalog_atributos"');
    expect(texto).toContain("union all");
    expect(texto).toContain("group by");
    // Ninguna columna c0 sin car.
    expect(texto).not.toContain('"c0"');
    expect(params).toContain("t-1");
    // Todas las claves del registro viajan como parámetros (nada interpolado).
    for (const c of REGISTRO) expect(params).toContain(c.clave);
    expect(params).toContain("^[a-z0-9._-]{1,24}$");
  });

  it("con car: cuenta las fallas por fila y cuál clave falló (para el conteo sin el filtro propio)", () => {
    const { sql: texto, params } = render(consultaFacetasPorTipoSql({ base, activas: ["polos", "curva"], tenant: "t-1" }));
    expect(texto).toContain('"c0"');
    expect(texto).toContain('"c1"');
    expect(texto).toContain("nfallas <= 1");
    expect(texto).toMatch(/fallada is null or .*fallada = /);
    expect(params.slice(0, 2)).toEqual(["polos", "curva"]);
  });

  it("los rangos válidos (RANGOS) acotan los valores numéricos en SQL", () => {
    const { params } = render(consultaFacetasPorTipoSql({ base, activas: [], tenant: "t-1" }));
    // potencia_w: [0.1, 100000]
    expect(params).toContain(0.1);
    expect(params).toContain(100_000);
  });
});

describe("entradaDeFilas", () => {
  it("mapea lista, rango y denominadores (total + fallas de la propia clave)", () => {
    const e = entradaDeFilas(
      [
        { tipo: "lista", clave: "polos", valor: "2.00", n: 5, min: null, max: null },
        { tipo: "lista", clave: "polos", valor: "2", n: 1, min: null, max: null },
        { tipo: "lista", clave: "polos", valor: "4", n: "3", min: null, max: null },
        { tipo: "lista", clave: "curva", valor: "c", n: 7, min: null, max: null },
        { tipo: "rango", clave: "potencia_w", valor: null, n: 4, min: "3.5", max: 60 },
        { tipo: "denominador", clave: null, valor: null, n: 10, min: null, max: null },
        { tipo: "denominador", clave: "polos", valor: null, n: 2, min: null, max: null },
      ],
      ["polos"],
      "Termomagnéticas",
    );
    expect(e.filas).toEqual([
      { clave: "polos", valor: "2", n: 6 },
      { clave: "polos", valor: "4", n: 3 },
      { clave: "curva", valor: "c", n: 7 },
    ]);
    expect(e.rangos).toEqual([{ clave: "potencia_w", min: 3.5, max: 60, n: 4 }]);
    expect(e.denominadores.polos).toBe(12);
    expect(e.denominadores.curva).toBe(10);
    expect(e.activas).toEqual(["polos"]);
    expect(e.categoria).toBe("Termomagnéticas");
  });

  it("sin filas: denominadores en 0 y nada que ofrecer", () => {
    const e = entradaDeFilas([], [], undefined);
    expect(e.filas).toEqual([]);
    expect(e.denominadores.polos).toBe(0);
    expect(e.categoria).toBeUndefined();
  });

  it("descarta filas con clave fuera del registro o números no finitos", () => {
    const e = entradaDeFilas(
      [
        { tipo: "lista", clave: "medidas_mm", valor: "10x10", n: 3, min: null, max: null },
        { tipo: "lista", clave: "polos", valor: "abc", n: 3, min: null, max: null },
        { tipo: "rango", clave: "flujo_lm", valor: null, n: 2, min: null, max: null },
      ],
      [],
    );
    expect(e.filas).toEqual([]);
    expect(e.rangos).toEqual([]);
  });
});
