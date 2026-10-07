import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { acotarPorDeducidas, condicionRecuperar, terminosQueRecuperan } from "./recuperar";
import { POTENCIA_NO_DOMESTICA_W, PUNTOS, esConsultaDeCasa, gruposDeOriginales, puntajeBusqueda } from "./ordenar";
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
  contradiceAtributo: (id) => (id === "desconocido" ? undefined : sql.raw(`CONTRADICE_${id.replace(/[-:]/g, "_")}`)),
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
    // "todos": los dos originales significativos (no el contexto); "reflector" cumple también por su expansión.
    expect(texto).toMatch(/\(case when \(TEXTO ~ \$\d+ or TEXTO ~ \$\d+\) and TEXTO ~ \$\d+ then 3 else 0 end\)/);
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

  it("con un solo original, la «frase» es el nombre que lo contiene (o a una de sus expansiones)", () => {
    const p = plan({ terminos: [{ texto: "escritorio", peso: 1 }, { texto: "luz", peso: 0.3 }], categorias: [{ nombre: "Lámparas", peso: 0.7 }] }, "escritorio luz");
    const { sql: texto, params } = render(puntajeBusqueda(p, piezas));
    expect(texto).toMatch(new RegExp(`\\(case when NOMBRE ~ \\$\\d+ then ${PUNTOS.frase} else 0 end\\)`));
    expect(params).toContain(patronTermino("escritorio"));
    // El nombre le gana a la categoría blanda más el contexto ("luz" en el nombre).
    expect(PUNTOS.nombre + PUNTOS.frase).toBeGreaterThan(PUNTOS.categoria + 0.3 * PUNTOS.nombre);
    const conSinonimo = render(puntajeBusqueda(plan({ terminos: [{ texto: "proyector", peso: 1 }, { texto: "reflector", peso: 0.7 }] }, "proyector"), piezas));
    expect(conSinonimo.sql).toMatch(new RegExp(`\\(case when \\(NOMBRE ~ \\$\\d+ or NOMBRE ~ \\$\\d+\\) then ${PUNTOS.frase} else 0 end\\)`));
  });

  it("con una medida en la consulta, un solo original no es frase ('hasta 50w': decide la medida)", () => {
    const { sql: texto } = render(puntajeBusqueda(plan({ terminos: [{ texto: "hasta", peso: 1 }, { texto: "50w", peso: 0.4 }] }, "hasta 50w"), piezas));
    expect(texto).not.toContain(`then ${PUNTOS.frase} else 0 end`);
  });

  it("«todos» cuenta una expansión como el original ('foco smart': un bulbo smart cumple)", () => {
    const terminos = [{ texto: "foco", peso: 1 }, { texto: "smart", peso: 1 }, { texto: "lampara", peso: 0.7 }, { texto: "bulbo", peso: 0.7 }];
    expect(gruposDeOriginales(["foco", "smart"], terminos)).toEqual([["foco", "lampara", "bulbo"], ["smart"]]);
    const { sql: texto, params } = render(puntajeBusqueda(plan({ terminos }, "foco smart"), piezas));
    expect(texto).toMatch(/\(case when \(TEXTO ~ \$\d+ or TEXTO ~ \$\d+ or TEXTO ~ \$\d+\) and TEXTO ~ \$\d+ then 3 else 0 end\)/);
    expect(params).toContain(patronTermino("bulbo"));
  });

  it("con la categoría filtrada que nombra a un original, «todos» pide sólo el resto ('foco inteligente' en Lámparas)", () => {
    const terminos = [{ texto: "foco", peso: 1 }, { texto: "inteligente", peso: 1 }, { texto: "lampara", peso: 0.7 }, { texto: "smart", peso: 0.7 }];
    const { sql: texto } = render(puntajeBusqueda(plan({ terminos }, "foco inteligente"), piezas, { categoriasFiltro: ["Lámparas"] }));
    expect(texto).toMatch(/\(case when \(TEXTO ~ \$\d+ or TEXTO ~ \$\d+\) then 3 else 0 end\)/);
    // Sin el filtro, los dos grupos.
    const sinFiltro = render(puntajeBusqueda(plan({ terminos }, "foco inteligente"), piezas)).sql;
    expect(sinFiltro).toMatch(/\(case when \(TEXTO ~ \$\d+ or TEXTO ~ \$\d+\) and \(TEXTO ~ \$\d+ or TEXTO ~ \$\d+\) then 3 else 0 end\)/);
    // Una categoría que no nombra a ninguno no cubre nada.
    expect(render(puntajeBusqueda(plan({ terminos }, "foco inteligente"), piezas, { categoriasFiltro: ["Reflectores"] })).sql).toBe(sinFiltro);
  });

  it("sin términos originales: sin prefijo ni «todos»", () => {
    const { sql: texto } = render(puntajeBusqueda(plan({ terminos: [{ texto: "taller", peso: 0.3 }] }, "luz fria para el taller"), piezas));
    expect(texto).not.toMatch(/then 2 else 0 end/);
    expect(texto).not.toMatch(/then 3 else 0 end/);
  });
});

describe("consulta de la casa: lo industrial o de alta potencia baja (nunca se excluye)", () => {
  it("lugares de la casa sin contexto industrial", () => {
    expect(esConsultaDeCasa("proyector para patio")).toBe(true);
    expect(esConsultaDeCasa("luz cálida para el living")).toBe(true);
    expect(esConsultaDeCasa("reflector para los balcones")).toBe(true);
    expect(esConsultaDeCasa("reflector para galpón")).toBe(false);
    expect(esConsultaDeCasa("proyector cancha padel")).toBe(false);
    expect(esConsultaDeCasa("reflector industrial para el patio")).toBe(false);
    expect(esConsultaDeCasa("reflector 50w")).toBe(false);
  });

  it("resta por 'industrial' en el nombre o potencia > 200 W; sin la pieza de potencia, sólo el nombre", () => {
    const p = plan({ terminos: [{ texto: "proyector", peso: 1 }, { texto: "patio", peso: 0.3 }] }, "proyector para patio");
    const conPotencia = render(puntajeBusqueda(p, { ...piezas, potencia: sql`POTENCIA` }));
    expect(conPotencia.sql).toContain(`-(case when (NOMBRE ~ $`);
    expect(conPotencia.sql).toContain(`or coalesce(POTENCIA, 0) > ${POTENCIA_NO_DOMESTICA_W}) then ${PUNTOS.industrialEnCasa} else 0 end)`);
    expect(conPotencia.params).toContain(patronTermino("industrial"));
    const sinPotencia = render(puntajeBusqueda(p, piezas));
    expect(sinPotencia.sql).toContain(`-(case when (NOMBRE ~ $`);
    expect(sinPotencia.sql).not.toContain("POTENCIA");
    // Menos que un término en el nombre: dentro de un empate reordena, no cambia de tipo de producto.
    expect(PUNTOS.industrialEnCasa).toBeLessThan(PUNTOS.nombre);
  });

  it("sin lugar de la casa (o con contexto industrial), no hay resta", () => {
    const p = plan({ terminos: [{ texto: "proyector", peso: 1 }, { texto: "cancha", peso: 0.3 }] }, "proyector cancha padel");
    expect(render(puntajeBusqueda(p, { ...piezas, potencia: sql`POTENCIA` })).sql).not.toContain("-(case");
  });

});

describe("orden de las medidas discretas: el que cumple, antes que el que contradice", () => {
  const puntaje = (atributos: { id: string; peso: number }[], p: PiezasBusqueda = piezas) => render(puntajeBusqueda(plan({ atributos }, "diferencial 25a"), p)).sql;

  it("una medida discreta de peso 1 suma +medidaDiscreta si cumple y resta contradiceMedida si contradice (contradice manda)", () => {
    const sqlTexto = puntaje([{ id: "corriente_a:25", peso: 1 }]);
    expect(sqlTexto).toContain(`case when CONTRADICE_corriente_a_25 then -${PUNTOS.contradiceMedida} when ATRIBUTO_corriente_a:25 then ${PUNTOS.medidaDiscreta} else 0 end`);
    // además del boost de siempre
    expect(sqlTexto).toContain("(case when ATRIBUTO_corriente_a:25 then $");
  });

  it("la penalidad y el premio superan por mucho cualquier otra parte del puntaje", () => {
    const otras = Object.entries(PUNTOS).filter(([k]) => k !== "medidaDiscreta" && k !== "contradiceMedida").reduce((t, [, v]) => t + v, 0);
    expect(PUNTOS.medidaDiscreta).toBeGreaterThan(10 * otras);
  });

  it("contradecir una clave pesa más que cumplir las cuatro discretas: sin contradicción primero, como orden", () => {
    expect(PUNTOS.contradiceMedida).toBeGreaterThan(4 * PUNTOS.medidaDiscreta + 10 * PUNTOS.frase);
  });

  it("las cuatro claves discretas: polos, corriente, sensibilidad y zócalo", () => {
    for (const id of ["polos:2", "corriente_a:25", "sensibilidad_ma:30", "zocalo:e27"]) {
      expect(puntaje([{ id, peso: 1 }])).toContain(`when CONTRADICE_${id.replace(":", "_")} then -${PUNTOS.contradiceMedida}`);
    }
  });

  it("confianza media (peso 0,9), claves blandas, ids del diccionario y rangos NO entran al orden estricto", () => {
    for (const a of [
      { id: "corriente_a:25", peso: 0.9 },
      { id: "potencia_w:9", peso: 1 },
      { id: "temperatura_k:4000", peso: 1 },
      { id: "tension_v:12", peso: 1 },
      { id: "zocalo-e27", peso: 1 },
      { id: "corriente_a:10-20", peso: 1 },
      { id: "tono-calido", peso: 1 },
    ]) {
      expect(puntaje([a])).not.toContain("CONTRADICE_");
    }
  });

  it("sin la pieza (el contexto sin estructurados) o si no se puede decidir el SQL: no hay orden estricto", () => {
    const { contradiceAtributo: _quitada, ...sinPieza } = piezas;
    void _quitada;
    expect(puntaje([{ id: "corriente_a:25", peso: 1 }], sinPieza)).not.toContain(`${PUNTOS.medidaDiscreta}`);
    expect(puntaje([{ id: "corriente_a:25", peso: 1 }], { ...piezas, contradiceAtributo: () => undefined })).not.toContain(`${PUNTOS.medidaDiscreta}`);
  });

  it("dos medidas discretas suman cada una por separado", () => {
    const sqlTexto = puntaje([{ id: "polos:2", peso: 1 }, { id: "corriente_a:25", peso: 1 }]);
    expect(sqlTexto.match(new RegExp(`then -${PUNTOS.contradiceMedida}`, "g"))).toHaveLength(2);
  });
});

describe("acotarPorDeducidas: la categoría deducida acota sin filtro ni chip", () => {
  const conDeducida = (terminos: CriterioPlan["blandos"]["terminos"]): CriterioPlan => ({
    ...plan({ categorias: [{ nombre: "Dicroicas", peso: 1 }], terminos }, "dicroica mr16"),
    deducidas: ["Dicroicas"],
  });

  it("sin deducidas devuelve la misma condición", () => {
    const c = sql`RECUPERAR`;
    expect(acotarPorDeducidas(plan(), piezas, c)).toBe(c);
  });

  it("la deducida no recupera su categoría entera: sólo la acota", () => {
    const p = conDeducida([{ texto: "dicroica", peso: 1 }, { texto: "mr16", peso: 0.4 }]);
    const { sql: texto } = render(condicionRecuperar(p, piezas)!);
    expect(texto).not.toContain("EN_CATEGORIAS");
  });

  it("acota a la categoría O a lo que tiene TODAS las palabras significativas (o un sinónimo de cada una)", () => {
    const p = conDeducida([
      { texto: "dicroica", peso: 1 },
      { texto: "mr16", peso: 0.4 },
      { texto: "dicro", peso: 0.7 },
    ]);
    const { sql: texto, params } = render(acotarPorDeducidas(p, piezas, sql`RECUPERAR`)!);
    expect(texto).toBe("((EN_CATEGORIAS($1) or ((TEXTO ~ $2 or TEXTO ~ $3) and TEXTO ~ $4)) and RECUPERAR)");
    expect(params).toEqual(["Dicroicas", patronTermino("dicroica"), patronTermino("dicro"), patronTermino("mr16")]);
  });

  it("con una sola palabra pedida no hay escape: sólo la categoría (\"pilas\" no trae \"pilastra\")", () => {
    const p = { ...conDeducida([{ texto: "pilas", peso: 1 }, { texto: "bateria", peso: 0.7 }]), deducidas: ["Pilas y baterias"] };
    const { sql: texto } = render(acotarPorDeducidas(p, piezas, sql`RECUPERAR`)!);
    expect(texto).toBe("(EN_CATEGORIAS($1) and RECUPERAR)");
  });

  it("sin nada que recupere, la categoría deducida entera (como cuando era filtro)", () => {
    const p = { ...conDeducida([{ texto: "patio", peso: 0.3 }]), deducidas: ["Luminarias exteriores"] };
    const { sql: texto, params } = render(acotarPorDeducidas(p, piezas, undefined)!);
    expect(texto).toBe("EN_CATEGORIAS($1)");
    expect(params).toEqual(["Luminarias exteriores"]);
  });
});
