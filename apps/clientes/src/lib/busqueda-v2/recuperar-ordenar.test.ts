import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { condicionRecuperar, terminosQueRecuperan } from "./recuperar";
import { PUNTOS, puntajeBusqueda } from "./ordenar";
import { patronFrase, patronInicio, patronTermino, type CriterioPlan, type PiezasBusqueda } from "./piezas";

const dialecto = new PgDialect();
const render = (s: SQL) => dialecto.sqlToQuery(s);

const piezas: PiezasBusqueda = {
  texto: sql`TEXTO`,
  nombre: sql`NOMBRE`,
  codigo: sql`CODIGO`,
  marcaCategoria: sql`MARCA`,
  enCategorias: (nombres) => sql`EN_CATEGORIAS(${sql.join(nombres.map((n) => sql`${n}`), sql`, `)})`,
  cumpleAtributo: (id) => (id === "desconocido" ? undefined : sql.raw(`ATRIBUTO_${id.replace(/-/g, "_")}`)),
  conStock: sql`CON_STOCK`,
};

const plan = (b: Partial<CriterioPlan["blandos"]> = {}, consulta = "foco calido"): CriterioPlan => ({
  consulta,
  blandos: { categorias: [], atributos: [], terminos: [], ...b },
});

describe("patrones de término", () => {
  it("comienzo de palabra, con la forma en singular y los especiales escapados", () => {
    expect(patronTermino("focos")).toBe("(^|[^a-z0-9])(focos|foco)");
    expect(patronTermino("3/4")).toBe("(^|[^a-z0-9])(3/4)");
    expect(patronTermino("2.5")).toBe("(^|[^a-z0-9])(2\\.5)");
    expect(patronInicio("lamparas")).toBe("^(lamparas|lampara)");
    const re = new RegExp(patronTermino("olor"));
    expect(re.test("extractor de olor")).toBe(true);
    expect(re.test("color blanco")).toBe(false);
    expect(new RegExp(patronTermino("toma")).test("automatismo")).toBe(false);
  });
});

describe("patrón de frase", () => {
  const cumple = (terminos: string[], texto: string) => new RegExp(patronFrase(terminos)!).test(texto);

  it("los términos en orden y juntos, con palabras de enlace entre ellos", () => {
    expect(cumple(["lampara", "escritorio"], "lampara de escritorio articulada blanca 40w")).toBe(true);
    expect(cumple(["lampara", "escritorio"], "lamparas para escritorio")).toBe(true);
    expect(cumple(["ventilador", "techo"], "ventilador de techo 52 con luz")).toBe(true);
    expect(cumple(["lampara", "escritorio"], "lampara escritorio")).toBe(true);
  });

  it("no encuentra otro orden, palabras de relleno ni una palabra que sólo contiene al término", () => {
    expect(cumple(["lampara", "escritorio"], "escritorio con lampara")).toBe(false);
    expect(cumple(["lampara", "escritorio"], "lampara led de escritorio")).toBe(false);
    expect(cumple(["lampara", "escritorio"], "lampara de microescritorio")).toBe(false);
    expect(cumple(["lampara", "escritorio"], "portalampara de escritorio")).toBe(false);
  });

  it("con menos de dos términos no es una frase", () => {
    expect(patronFrase(["lampara"])).toBeNull();
    expect(patronFrase([])).toBeNull();
  });
});

describe("recuperar", () => {
  it("fuertes: OR de términos que recuperan y categorías blandas con peso ≥ 0,6", () => {
    const p = plan({
      terminos: [
        { texto: "foco", peso: 1 },
        { texto: "lampara", peso: 0.7 },
        { texto: "cocina", peso: 0.3 },
        { texto: "20", peso: 0.4 },
      ],
      categorias: [
        { nombre: "Bulbos", peso: 0.9 },
        { nombre: "Lámparas", peso: 0.5 },
      ],
      atributos: [{ id: "tono-calido", peso: 0.9 }],
    });
    expect(terminosQueRecuperan(p)).toEqual(["foco", "lampara"]);
    const { sql: texto, params } = render(condicionRecuperar(p, piezas)!);
    // La categoría débil y el atributo blando no traen candidatos si ya hay fuertes (sólo ordenan).
    expect(texto).toBe("(TEXTO ~ $1 or TEXTO ~ $2 or EN_CATEGORIAS($3))");
    expect(params).toEqual(["(^|[^a-z0-9])(foco)", "(^|[^a-z0-9])(lampara)", "Bulbos"]);
  });

  it("sin fuertes: recuperan las categorías débiles y los atributos blandos", () => {
    const p = plan({
      terminos: [{ texto: "noche", peso: 0.3 }],
      categorias: [
        { nombre: "Reflectores", peso: 0.52 },
        { nombre: "ILUMINACION", peso: 0.5 },
      ],
      atributos: [
        { id: "apto-exterior", peso: 1 },
        { id: "desconocido", peso: 0.9 },
      ],
    });
    expect(render(condicionRecuperar(p, piezas)!).sql).toBe("(EN_CATEGORIAS($1, $2) or ATRIBUTO_apto_exterior)");
  });

  describe("consulta de SOLO medida (sin términos que recuperen): recupera la medida, nunca la categoría de Jev", () => {
    const categoriasDeJev = [
      { nombre: "Electricidad", peso: 0.5 },
      { nombre: "Interruptores", peso: 0.95 },
    ];

    it("'6ka': los que tienen el valor o lo nombran; la categoría (débil o fuerte) sólo ordena", () => {
      const p = plan(
        { terminos: [{ texto: "6ka", peso: 0.4 }], categorias: categoriasDeJev, atributos: [{ id: "poder_corte_ka:6", peso: 0.9 }] },
        "6ka",
      );
      const { sql: texto, params } = render(condicionRecuperar(p, piezas)!);
      expect(texto).toBe("(TEXTO ~ $1 or ATRIBUTO_poder_corte_ka:6)");
      expect(params).toEqual(["(^|[^a-z0-9])(6ka)"]);
      expect(texto).not.toContain("EN_CATEGORIAS");
      // ...y la categoría sigue ordenando.
      expect(render(puntajeBusqueda(p, piezas)).sql).toContain("EN_CATEGORIAS");
    });

    it("'ip65': recupera por ip >= 65 (el id dinámico); el atributo del diccionario y la categoría sólo ordenan", () => {
      const p = plan(
        {
          categorias: categoriasDeJev,
          atributos: [
            { id: "apto-exterior", peso: 0.9 },
            { id: "ip:65", peso: 0.9 },
          ],
        },
        "ip65",
      );
      expect(render(condicionRecuperar(p, piezas)!).sql).toBe("ATRIBUTO_ip:65");
    });

    it("recupera por TODAS las medidas del plan (potencia exacta y banda) y por los términos de orden", () => {
      const p = plan(
        {
          terminos: [{ texto: "9w", peso: 0.4 }],
          categorias: categoriasDeJev,
          atributos: [
            { id: "potencia_w:9", peso: 0.5 },
            { id: "potencia_w:8-10", peso: 0.5 },
            { id: "tono-calido", peso: 0.9 },
          ],
        },
        "9w",
      );
      expect(render(condicionRecuperar(p, piezas)!).sql).toBe("(TEXTO ~ $1 or ATRIBUTO_potencia_w:9 or ATRIBUTO_potencia_w:8_10)");
    });

    it("con un término que recupera ('termica 6ka') no cambia nada: la categoría fuerte sigue trayendo candidatos", () => {
      const p = plan(
        {
          terminos: [{ texto: "termica", peso: 1 }, { texto: "6ka", peso: 0.4 }],
          categorias: [{ nombre: "Interruptores", peso: 0.95 }],
          atributos: [{ id: "poder_corte_ka:6", peso: 0.9 }],
        },
        "termica 6ka",
      );
      expect(render(condicionRecuperar(p, piezas)!).sql).toBe("(TEXTO ~ $1 or EN_CATEGORIAS($2))");
    });

    it("sin medida en el plan, las categorías débiles siguen recuperando (el caso 'farol para la entrada')", () => {
      const p = plan({ categorias: [{ nombre: "Reflectores", peso: 0.52 }], atributos: [{ id: "apto-exterior", peso: 1 }] }, "entrada");
      expect(render(condicionRecuperar(p, piezas)!).sql).toBe("(EN_CATEGORIAS($1) or ATRIBUTO_apto_exterior)");
    });
  });

  it("sin nada que recupere (sólo contexto y medidas): undefined, vale la clásica", () => {
    expect(condicionRecuperar(plan({ terminos: [{ texto: "patio", peso: 0.3 }] }), piezas)).toBeUndefined();
  });

  it("una sola parte, sin paréntesis extra", () => {
    expect(render(condicionRecuperar(plan({ categorias: [{ nombre: "Tubos", peso: 0.5 }] }), piezas)!).sql).toBe(
      "EN_CATEGORIAS($1)",
    );
  });
});

describe("ordenar", () => {
  it("puntaje por término (× peso), código exacto, prefijo, todos, blandos y stock", () => {
    const p = plan(
      {
        terminos: [
          { texto: "reflector", peso: 1 },
          { texto: "led", peso: 0.3 },
          { texto: "potente", peso: 1 },
          { texto: "proyector", peso: 0.7 },
        ],
        categorias: [{ nombre: "Reflectores", peso: 0.5 }],
        atributos: [{ id: "apto-exterior", peso: 0.9 }],
      },
      "Reflector LED potente",
    );
    const { sql: texto, params } = render(puntajeBusqueda(p, piezas));
    // Un CASE por término, con los puntos literales de la búsqueda clásica.
    expect(texto.match(/then 4 when CODIGO ~ \$\d+ then 3 when MARCA ~ \$\d+ then 2 when TEXTO ~ \$\d+ then 1 else 0 end/g)).toHaveLength(4);
    expect(texto).toContain(`(case when CODIGO = $`);
    expect(texto).toContain(`then ${PUNTOS.codigoExacto} else 0 end)`);
    expect(texto).toMatch(/\(case when NOMBRE ~ \$\d+ then 2 else 0 end\)/);
    // "todos": los dos originales significativos (no el contexto ni la expansión).
    expect(texto).toMatch(/\(case when TEXTO ~ \$\d+ and TEXTO ~ \$\d+ then 3 else 0 end\)/);
    expect(texto).toContain("(case when EN_CATEGORIAS(");
    expect(texto).toContain("(case when ATRIBUTO_apto_exterior then $");
    expect(texto).toContain("(case when CON_STOCK then 1 else 0 end)");
    expect(params).toContain("reflector led potente");
    expect(params).toContain("^(reflector)");
    expect(params).toContain(3); // 6 × 0,5
    expect(params).toContain(2.7); // 3 × 0,9
    expect(params).toContain(0.7);
  });

  it("frase: el nombre con los originales en orden y juntos suma 10 (con dos o más originales)", () => {
    const p = plan({ terminos: [{ texto: "lampara", peso: 1 }, { texto: "escritorio", peso: 1 }, { texto: "luz", peso: 0.3 }, { texto: "velador", peso: 0.7 }] }, "lampara de escritorio");
    const { sql: texto, params } = render(puntajeBusqueda(p, piezas));
    expect(texto).toContain(`(case when NOMBRE ~ $`);
    expect(texto).toMatch(new RegExp(`\\(case when NOMBRE ~ \\$\\d+ then ${PUNTOS.frase} else 0 end\\)`));
    expect(params).toContain(patronFrase(["lampara", "escritorio"]));
    // Una frase de verdad pesa más que lo que suman una categoría blanda y un prefijo.
    expect(PUNTOS.frase).toBeGreaterThan(PUNTOS.categoria);
  });

  it("con un solo original no hay frase", () => {
    const { sql: texto } = render(puntajeBusqueda(plan({ terminos: [{ texto: "lampara", peso: 1 }, { texto: "luz", peso: 0.3 }] }, "lampara luz"), piezas));
    expect(texto).not.toContain(`then ${PUNTOS.frase} else 0 end`);
  });

  it("sin términos originales: sin prefijo ni «todos»", () => {
    const { sql: texto } = render(puntajeBusqueda(plan({ terminos: [{ texto: "taller", peso: 0.3 }] }, "luz fria para el taller"), piezas));
    expect(texto).not.toMatch(/then 2 else 0 end/);
    expect(texto).not.toMatch(/then 3 else 0 end/);
  });
});
