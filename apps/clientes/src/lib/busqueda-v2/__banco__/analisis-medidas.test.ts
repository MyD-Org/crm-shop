import { describe, expect, it } from "vitest";
import type { CasoJson } from "./corrida";
import type { MedidaEsperadaJson, MedidaJson } from "./medida-json";
import { entradasDeReporte, formatearAnalisis, impactoPorClave, parsearArgsAnalisis, parsearReporteMedidas, rankingContradicciones, rankingInversiones, totalesPorClave, type ReporteMedidas } from "./analisis-medidas";

const esp = (clave: string, p: Partial<MedidaEsperadaJson> = {}): MedidaEsperadaJson => ({ clave, valor: "1", dura: false, con: 0, cumple: 0, contradice: 0, duras: 0, ...p });
const medida = (esperadas: MedidaEsperadaJson[], p: Partial<MedidaJson> = {}): MedidaJson => ({ hit: true, falsoPositivo: null, pagina: 24, esperadas, ...p });
const caso = (idx: number, m?: MedidaJson, p: Partial<CasoJson> = {}): CasoJson => ({
  idx,
  q: `consulta ${idx}`,
  tipo: "medida",
  perfil: "particular",
  posicion: null,
  rr: null,
  precision: null,
  total: 10,
  top24Ok: null,
  intencionOk: null,
  categoriaOk: null,
  atributosOk: null,
  zero: false,
  ...(m ? { medida: m } : {}),
  ...p,
});
const reporte = (casos: CasoJson[]): ReporteMedidas => ({ cabecera: { tuberia: "v2", busquedaMedidas: "on", banco: { n: casos.length, hash: "abc" } }, casos });

// 0: polos dura en plan, 3 duras contradicen. 1: polos blanda en plan, 2 contradicen (esperada dura). 2: corriente_a ausente del plan, 1 contradice (blanda).
// 3: polos dura en plan sin contradicciones. 4: sin medida (no es de medidas). 5: negativo (sin esperadas).
const casos = [
  caso(0, medida([esp("polos", { dura: true, con: 10, cumple: 7, contradice: 3, duras: 3 })], { plan: ["polos:2", "corriente_a:20"], duros: ["polos:2"] })),
  caso(1, medida([esp("polos", { dura: true, con: 8, cumple: 6, contradice: 2, duras: 2 })], { plan: ["polos:2"], duros: [] })),
  caso(2, medida([esp("corriente_a", { con: 12, cumple: 11, contradice: 1 })], { plan: ["polos:1"], duros: ["polos:1"] })),
  caso(3, medida([esp("polos", { dura: true, con: 20, cumple: 20 })], { plan: ["polos:2"], duros: ["polos:2"] })),
  caso(4),
  caso(5, medida([], { plan: [], duros: [] })),
];

describe("entradasDeReporte", () => {
  it("una entrada por (caso x medida esperada), con el estado de la clave en el plan", () => {
    const { entradas, casosConMedida, casosEvaluables } = entradasDeReporte(reporte(casos));
    expect(casosConMedida).toBe(5);
    expect(casosEvaluables).toBe(4);
    expect(entradas.map((e) => [e.idx, e.clave, e.estado])).toEqual([
      [0, "polos", "dura"],
      [1, "polos", "blanda"],
      [2, "corriente_a", "ausente"],
      [3, "polos", "dura"],
    ]);
  });

  it("ids del diccionario cuentan para su clave; en un banco enmascarado el plan ya viene en claves", () => {
    const c = caso(0, medida([esp("zocalo", { dura: true, con: 5, cumple: 5 }), esp("ip", { con: 5, cumple: 5 })], { plan: ["zocalo-e27", "apto-exterior"], duros: ["zocalo-e27"] }));
    const c2 = caso(1, medida([esp("polos", { con: 5, cumple: 5 })], { plan: ["polos"], duros: ["polos"] }));
    const { entradas } = entradasDeReporte(reporte([c, c2]));
    expect(entradas.map((e) => e.estado)).toEqual(["dura", "blanda", "dura"]);
  });

  it("tubería sin medidas (plan ausente): estado 'sin-plan'", () => {
    const { entradas } = entradasDeReporte(reporte([caso(0, medida([esp("polos", { con: 1, cumple: 1 })]))]));
    expect(entradas[0].estado).toBe("sin-plan");
  });

  it("la consulta sale del caso (ya enmascarada si el banco es local): sin q usa #idx", () => {
    const { entradas } = entradasDeReporte(reporte([caso(7, medida([esp("polos")], { plan: [], duros: [] }), { q: undefined })]));
    expect(entradas[0].q).toBe("#7");
  });
});

describe("rankingContradicciones", () => {
  const { entradas } = entradasDeReporte(reporte(casos));

  it("ordena por contradicciones duras (desc), luego contradicciones, luego idx; sólo las que tienen duras", () => {
    const r = rankingContradicciones(entradas);
    expect(r.map((e) => [e.idx, e.clave, e.duras])).toEqual([
      [0, "polos", 3],
      [1, "polos", 2],
    ]);
    expect(r[0]).toMatchObject({ q: "consulta 0", plan: ["polos:2", "corriente_a:20"], contradice: 3, con: 10, estado: "dura" });
  });

  it("soloDuras:false incluye también las blandas (corriente_a)", () => {
    expect(rankingContradicciones(entradas, { soloDuras: false }).map((e) => e.idx)).toEqual([0, 1, 2]);
  });

  it("top corta la lista", () => {
    expect(rankingContradicciones(entradas, { top: 1 })).toHaveLength(1);
  });

  it("filtra por clave", () => {
    expect(rankingContradicciones(entradas, { soloDuras: false, clave: "corriente_a" }).map((e) => e.idx)).toEqual([2]);
  });
});

describe("rankingInversiones (orden: contradicciones por encima de lo que cumple)", () => {
  const conOrden = [
    caso(0, medida([esp("polos", { dura: true, con: 10, cumple: 7, contradice: 3, duras: 3, inversiones: 12, arriba: 3 })], { plan: ["polos:2"], duros: [] })),
    caso(1, medida([esp("corriente_a", { con: 12, cumple: 11, contradice: 1, inversiones: 5, arriba: 1 }), esp("polos", { con: 5, cumple: 5 })], { plan: ["corriente_a:20"], duros: [] })),
    caso(2, medida([esp("zocalo", { con: 12, cumple: 11, contradice: 1, inversiones: 0, arriba: 0 })], { plan: ["zocalo:e27"], duros: [] })),
    // JSON anterior a la métrica: sin inversiones (no se cuentan como 0 en el ranking, no aparecen)
    caso(3, medida([esp("polos", { con: 5, cumple: 4, contradice: 1 })], { plan: [], duros: [] })),
  ];
  const { entradas } = entradasDeReporte(reporte(conOrden));

  it("entradas traen inversiones y arriba (0 si el JSON no los trae)", () => {
    expect(entradas.map((e) => [e.idx, e.clave, e.inversiones, e.arriba])).toEqual([
      [0, "polos", 12, 3],
      [1, "corriente_a", 5, 1],
      [1, "polos", 0, 0],
      [2, "zocalo", 0, 0],
      [3, "polos", 0, 0],
    ]);
  });

  it("ordena por inversiones desc y sólo incluye las que tienen", () => {
    expect(rankingInversiones(entradas).map((e) => [e.idx, e.clave, e.inversiones])).toEqual([
      [0, "polos", 12],
      [1, "corriente_a", 5],
    ]);
    expect(rankingInversiones(entradas, { top: 1 })).toHaveLength(1);
    expect(rankingInversiones(entradas, { clave: "corriente_a" }).map((e) => e.idx)).toEqual([1]);
  });

  it("totalesPorClave suma inversiones y casos con inversión", () => {
    const t = totalesPorClave(entradas);
    expect(t.find((x) => x.clave === "polos")).toMatchObject({ inversiones: 12, casosConInversion: 1, arriba: 3 });
    expect(t.find((x) => x.clave === "zocalo")).toMatchObject({ inversiones: 0, casosConInversion: 0 });
  });

  it("formatearAnalisis imprime la sección de orden y el total", () => {
    const t = formatearAnalisis(reporte(conOrden), {});
    expect(t).toContain("## Orden: contradicciones por encima de lo que cumple");
    expect(t).toMatch(/consulta 0 \| polos:2 \| polos \| 12 inversiones \(3 arriba\)/);
    expect(t).toContain("Total: 17 inversiones en 2 casos");
  });

  it("sin inversiones lo dice", () => {
    const t = formatearAnalisis(reporte([caso(0, medida([esp("polos", { con: 3, cumple: 3, inversiones: 0, arriba: 0 })], { plan: [], duros: [] }))]), {});
    expect(t).toContain("Ninguna inversión de orden");
  });
});

describe("totalesPorClave", () => {
  it("suma por clave: casos, con, cumple, contradice, duras y blandas, precisión y cobertura", () => {
    const t = totalesPorClave(entradasDeReporte(reporte(casos)).entradas);
    const polos = t.find((x) => x.clave === "polos")!;
    expect(polos).toMatchObject({ casos: 3, con: 38, cumple: 33, contradice: 5, duras: 5, blandas: 0, casosConContradiccion: 2 });
    expect(polos.precision).toBeCloseTo(33 / 38, 10);
    expect(polos.cobertura).toBeCloseTo(38 / 72, 10);
    const corriente = t.find((x) => x.clave === "corriente_a")!;
    expect(corriente).toMatchObject({ casos: 1, contradice: 1, duras: 0, blandas: 1 });
  });

  it("ordena por contradicciones duras desc y luego por clave; precisión null si nadie tiene dato", () => {
    const t = totalesPorClave(entradasDeReporte(reporte([...casos, caso(9, medida([esp("zocalo")], { plan: [], duros: [] }))])).entradas);
    expect(t.map((x) => x.clave)).toEqual(["polos", "corriente_a", "zocalo"]);
    expect(t[2].precision).toBeNull();
  });
});

describe("impactoPorClave (qué cambia si cambia la política de claves duras)", () => {
  const impacto = impactoPorClave(entradasDeReporte(reporte(casos)).entradas);

  it("separa los casos donde la clave es dura en el plan de los demás, con sus contradicciones y cobertura", () => {
    const polos = impacto.find((x) => x.clave === "polos")!;
    expect(polos.dura).toMatchObject({ casos: 2, contradice: 3, casosConContradiccion: 1 });
    expect(polos.dura.cobertura).toBeCloseTo(30 / 48, 10);
    expect(polos.blanda).toMatchObject({ casos: 1, contradice: 2, casosConContradiccion: 1 });
  });

  it("cambiaSiPasaABlanda: los casos con la clave dura (su resultado dejaría de filtrarse)", () => {
    expect(impacto.find((x) => x.clave === "polos")!.cambiaSiPasaABlanda).toEqual([0, 3]);
    expect(impacto.find((x) => x.clave === "corriente_a")!.cambiaSiPasaABlanda).toEqual([]);
  });

  it("cambiaSiPasaADura: los casos con la clave blanda o ausente que hoy contradicen (un filtro duro los limpiaría)", () => {
    expect(impacto.find((x) => x.clave === "polos")!.cambiaSiPasaADura).toEqual([1]);
    expect(impacto.find((x) => x.clave === "corriente_a")!.cambiaSiPasaADura).toEqual([2]);
  });
});

describe("formatearAnalisis", () => {
  it("imprime cabecera, ranking, totales por clave e impacto de la política", () => {
    const t = formatearAnalisis(reporte(casos), { top: 20 });
    expect(t).toContain("tubería v2");
    expect(t).toContain("busqueda-medidas: on");
    expect(t).toContain("5 casos con medida, 4 evaluables");
    expect(t).toContain("## Casos con contradicciones duras");
    expect(t).toContain("consulta 0");
    expect(t).toContain("polos:2, corriente_a:20");
    expect(t).toContain("## Totales por clave");
    expect(t).toContain("## Si cambiara la política de claves duras");
    expect(t).toMatch(/polos[^\n]*pasa a blanda[^\n]*0, 3/);
  });

  it("sin ninguna contradicción dura lo dice", () => {
    const t = formatearAnalisis(reporte([caso(0, medida([esp("polos", { con: 3, cumple: 3 })], { plan: [], duros: [] }))]), {});
    expect(t).toContain("Ninguna contradicción dura");
  });

  it("sin detalle de medidas (JSON de antes) explica cómo regenerarlo", () => {
    const t = formatearAnalisis(reporte([caso(0)]), {});
    expect(t).toContain("no trae el detalle de medidas");
    expect(t).toContain("--json");
  });

  it("--clave limita todo a esa clave", () => {
    const t = formatearAnalisis(reporte(casos), { clave: "corriente_a" });
    expect(t).toContain("clave corriente_a");
    expect(t).not.toContain("consulta 0");
    expect(t).toContain("consulta 2");
  });
});

describe("parsearReporteMedidas", () => {
  it("acepta un reporte con casos", () => {
    expect(parsearReporteMedidas(JSON.parse(JSON.stringify(reporte(casos)))).casos).toHaveLength(6);
  });

  it("rechaza lo que no es un reporte del banco, sin citar el contenido", () => {
    expect(() => parsearReporteMedidas({ hola: "mundo" })).toThrow(/reporte/);
    expect(() => parsearReporteMedidas(null)).toThrow(/reporte/);
    expect(() => parsearReporteMedidas({ cabecera: {}, casos: "x" })).toThrow(/reporte/);
  });
});

describe("parsearArgsAnalisis", () => {
  it("archivo posicional y opciones", () => {
    expect(parsearArgsAnalisis(["tmp/corrida.json"])).toEqual({ archivo: "tmp/corrida.json" });
    expect(parsearArgsAnalisis(["tmp/corrida.json", "--top=5", "--clave=corriente_a"])).toEqual({ archivo: "tmp/corrida.json", top: 5, clave: "corriente_a" });
  });

  it("falla sin archivo, con dos, con opciones desconocidas o inválidas; sin citar el valor", () => {
    expect(() => parsearArgsAnalisis([])).toThrow(/Uso/);
    expect(() => parsearArgsAnalisis(["a.json", "b.json"])).toThrow(/un solo archivo/);
    expect(() => parsearArgsAnalisis(["a.json", "--ver"])).toThrow(/desconocido/);
    expect(() => parsearArgsAnalisis(["a.json", "--top=0"])).toThrow(/--top/);
    expect(() => parsearArgsAnalisis(["a.json", "--top=x"])).toThrow(/--top/);
    expect(() => parsearArgsAnalisis(["a.json", "--clave=Mal Valor"])).toThrow(/--clave/);
    try {
      parsearArgsAnalisis(["a.json", "--clave=Mal Valor"]);
    } catch (e) {
      expect((e as Error).message).not.toContain("Mal Valor");
    }
  });
});
