import { describe, expect, it } from "vitest";
import type { ProductoBanco, ResultadoBanco } from "./banco";
import type { BusquedaBanco, MedidaBanco } from "./modelo";
import { claveDeId, cumpleMedida, evaluarMedidas, ordenDeVeredictos } from "./medida-oraculo";

type Atributos = NonNullable<ProductoBanco["atributosEstructurados"]>;

const caso = (medidas: MedidaBanco[] | undefined, extra: Partial<BusquedaBanco> = {}): BusquedaBanco => ({
  q: "consulta generica",
  perfil: "particular",
  ...(medidas ? { medidas } : {}),
  ...extra,
});
const prod = (atributos?: Atributos): ProductoBanco => ({ name: "producto generico", ...(atributos ? { atributosEstructurados: atributos } : {}) });
const num = (n: number) => ({ n, t: null });
const txt = (t: string) => ({ n: null, t });
const resultado = (productos: ProductoBanco[], extra: Partial<ResultadoBanco> = {}): ResultadoBanco => ({
  categoriasDuras: [],
  categoriasBlandas: [],
  atributosDuros: [],
  expansiones: [],
  productos,
  total: productos.length,
  ...extra,
});
const veces = <T>(n: number, f: () => T): T[] => Array.from({ length: n }, f);

describe("cumpleMedida (oráculo propio del banco)", () => {
  it("igual numérico: exacto, con tolerancia de redondeo", () => {
    expect(cumpleMedida({ clave: "corriente_a", valor: 20 }, num(20))).toBe(true);
    expect(cumpleMedida({ clave: "corriente_a", valor: 20 }, num(25))).toBe(false);
    expect(cumpleMedida({ clave: "potencia_w", valor: 9.5 }, num(9.5000000001))).toBe(true);
  });

  it("texto: sin distinguir mayúsculas", () => {
    expect(cumpleMedida({ clave: "zocalo", valor: "e27" }, txt("E27"))).toBe(true);
    expect(cumpleMedida({ clave: "zocalo", valor: "e27" }, txt("e14"))).toBe(false);
  });

  it("rango inclusivo, con uno o dos extremos", () => {
    const entre = { clave: "potencia_w", min: 10, max: 20 };
    expect(cumpleMedida(entre, num(10))).toBe(true);
    expect(cumpleMedida(entre, num(20))).toBe(true);
    expect(cumpleMedida(entre, num(20.1))).toBe(false);
    expect(cumpleMedida({ clave: "potencia_w", max: 50 }, num(49))).toBe(true);
    expect(cumpleMedida({ clave: "potencia_w", max: 50 }, num(51))).toBe(false);
    expect(cumpleMedida({ clave: "potencia_w", min: 20 }, num(20))).toBe(true);
  });

  it("ip: el pedido o superior", () => {
    expect(cumpleMedida({ clave: "ip", valor: 54 }, num(54))).toBe(true);
    expect(cumpleMedida({ clave: "ip", valor: 54 }, num(67))).toBe(true);
    expect(cumpleMedida({ clave: "ip", valor: 54 }, num(44))).toBe(false);
  });

  it("sin dato del tipo pedido: null (ni cumple ni contradice)", () => {
    expect(cumpleMedida({ clave: "corriente_a", valor: 20 }, undefined)).toBeNull();
    expect(cumpleMedida({ clave: "corriente_a", valor: 20 }, txt("x"))).toBeNull();
    expect(cumpleMedida({ clave: "zocalo", valor: "e27" }, num(27))).toBeNull();
  });
});

describe("evaluarMedidas: precisión, contradicciones y cobertura sobre el top 24", () => {
  it("escenario de la spec: 8 con 2 polos, 2 con 1 polo y 14 sin dato", () => {
    const productos = [
      ...veces(8, () => prod({ polos: num(2) })),
      ...veces(2, () => prod({ polos: num(1) })),
      ...veces(14, () => prod()),
    ];
    const m = evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado(productos))!;
    expect(m.precision).toBeCloseTo(0.8, 10);
    expect(m.contradicciones).toBe(2);
    expect(m.cobertura).toBeCloseTo(10 / 24, 10);
    expect(m.contradiccionesDuras).toBeNull();
  });

  it("sólo mira la primera página de 24", () => {
    const productos = [...veces(24, () => prod({ polos: num(2) })), ...veces(10, () => prod({ polos: num(1) }))];
    const m = evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado(productos))!;
    expect(m.precision).toBe(1);
    expect(m.contradicciones).toBe(0);
    expect(m.cobertura).toBe(1);
  });

  it("página sin ningún producto con la clave: precisión n/a (null, no 0), cobertura 0", () => {
    const m = evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado(veces(5, () => prod())))!;
    expect(m.precision).toBeNull();
    expect(m.contradicciones).toBe(0);
    expect(m.cobertura).toBe(0);
  });

  it("página vacía: todo null (no hay nada que medir)", () => {
    const m = evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado([], { total: 0 }))!;
    expect(m.precision).toBeNull();
    expect(m.cobertura).toBeNull();
  });

  it("con varias medidas agrega por par (producto x medida)", () => {
    // 4 productos x 2 medidas = 8 pares. polos: 3 con dato (2 cumplen, 1 contradice). corriente: 4 con dato (3 cumplen, 1 contradice).
    const productos = [
      prod({ polos: num(2), corriente_a: num(20) }),
      prod({ polos: num(2), corriente_a: num(20) }),
      prod({ polos: num(1), corriente_a: num(25) }),
      prod({ corriente_a: num(20) }),
    ];
    const m = evaluarMedidas(
      caso([
        { clave: "polos", valor: 2 },
        { clave: "corriente_a", valor: 20 },
      ]),
      resultado(productos),
    )!;
    expect(m.precision).toBeCloseTo(5 / 7, 10);
    expect(m.contradicciones).toBe(2);
    expect(m.cobertura).toBeCloseTo(7 / 8, 10);
  });

  it("contradicciones duras: sólo cuentan las medidas con dura:true", () => {
    const productos = [prod({ polos: num(1), corriente_a: num(25) }), prod({ polos: num(2), corriente_a: num(25) })];
    const m = evaluarMedidas(
      caso([
        { clave: "polos", valor: 2, dura: true },
        { clave: "corriente_a", valor: 20 },
      ]),
      resultado(productos),
    )!;
    expect(m.contradicciones).toBe(3);
    expect(m.contradiccionesDuras).toBe(1);
  });

  it("rango, texto e ip", () => {
    const productos = [prod({ potencia_w: num(12) }), prod({ potencia_w: num(30) }), prod({ potencia_w: num(18) })];
    expect(evaluarMedidas(caso([{ clave: "potencia_w", min: 10, max: 20 }]), resultado(productos))!.precision).toBeCloseTo(2 / 3, 10);
    expect(evaluarMedidas(caso([{ clave: "zocalo", valor: "e27" }]), resultado([prod({ zocalo: txt("e27") }), prod({ zocalo: txt("e14") })]))!.precision).toBe(0.5);
    const ips = [prod({ ip: num(44) }), prod({ ip: num(65) }), prod({ ip: num(67) })];
    const m = evaluarMedidas(caso([{ clave: "ip", valor: 65 }]), resultado(ips))!;
    expect(m.precision).toBeCloseTo(2 / 3, 10);
    expect(m.contradicciones).toBe(1);
  });

  it("sin expectativa de medidas: no hay evaluación", () => {
    expect(evaluarMedidas(caso(undefined), resultado([prod()]))).toBeUndefined();
  });
});

describe("evaluarMedidas: hit (el plan produjo la medida)", () => {
  const productos = [prod({ polos: num(2), corriente_a: num(20) })];
  const esperadas: MedidaBanco[] = [
    { clave: "polos", valor: 2 },
    { clave: "corriente_a", valor: 20 },
  ];

  it("null cuando la tubería no produce medidas (r.medidas ausente): no se cuenta como fallo", () => {
    expect(evaluarMedidas(caso(esperadas), resultado(productos))!.hit).toBeNull();
  });

  it("true si todas las esperadas están por su id", () => {
    expect(evaluarMedidas(caso(esperadas), resultado(productos, { medidas: ["polos:2", "corriente_a:20", "potencia_w:9"] }))!.hit).toBe(true);
  });

  it("false si falta alguna o el valor es otro", () => {
    expect(evaluarMedidas(caso(esperadas), resultado(productos, { medidas: ["polos:2"] }))!.hit).toBe(false);
    expect(evaluarMedidas(caso(esperadas), resultado(productos, { medidas: ["polos:2", "corriente_a:25"] }))!.hit).toBe(false);
  });

  it("con dura:true además tiene que estar entre los duros del plan", () => {
    const duras: MedidaBanco[] = [{ clave: "polos", valor: 2, dura: true }];
    expect(evaluarMedidas(caso(duras), resultado(productos, { medidas: ["polos:2"], atributosDuros: [] }))!.hit).toBe(false);
    expect(evaluarMedidas(caso(duras), resultado(productos, { medidas: ["polos:2"], atributosDuros: ["polos:2"] }))!.hit).toBe(true);
  });

  it("un rango min+max se espera como banda (id clave:a-b); un solo extremo no tiene id y no cuenta", () => {
    expect(evaluarMedidas(caso([{ clave: "potencia_w", min: 8, max: 10 }]), resultado(productos, { medidas: ["potencia_w:8-10"] }))!.hit).toBe(true);
    expect(evaluarMedidas(caso([{ clave: "potencia_w", max: 50 }]), resultado(productos, { medidas: [] }))!.hit).toBeNull();
  });

  it("sinMedidasDe: false si el plan produjo alguna medida de esa clave", () => {
    const c = caso([{ clave: "seccion_mm2", valor: 2.5 }], { sinMedidasDe: ["polos"] });
    expect(evaluarMedidas(c, resultado(productos, { medidas: ["seccion_mm2:2.5"] }))!.hit).toBe(true);
    expect(evaluarMedidas(c, resultado(productos, { medidas: ["seccion_mm2:2.5", "polos:1"] }))!.hit).toBe(false);
  });
});

describe("evaluarMedidas: falsos positivos (medidas: [] y sinMedidasDe)", () => {
  it("DL-18W (medidas: []) con un plan que emite polos: falso positivo", () => {
    const m = evaluarMedidas(caso([]), resultado([prod()], { medidas: ["polos:2"] }))!;
    expect(m.falsoPositivo).toBe(true);
    expect(m.hit).toBeNull();
    expect(m.precision).toBeNull();
    expect(m.contradicciones).toBeNull();
  });

  it("plan sin medidas: no es falso positivo; tubería que no produce medidas: null", () => {
    expect(evaluarMedidas(caso([]), resultado([prod()], { medidas: [] }))!.falsoPositivo).toBe(false);
    expect(evaluarMedidas(caso([]), resultado([prod()]))!.falsoPositivo).toBeNull();
  });

  it("sinMedidasDe cuenta como falso positivo sólo si se produjo esa clave", () => {
    const c = caso([{ clave: "seccion_mm2", valor: 2.5 }], { sinMedidasDe: ["polos"] });
    expect(evaluarMedidas(c, resultado([prod()], { medidas: ["seccion_mm2:2.5"] }))!.falsoPositivo).toBe(false);
    expect(evaluarMedidas(c, resultado([prod()], { medidas: ["polos:1"] }))!.falsoPositivo).toBe(true);
  });

  it("un caso con medidas esperadas y sin sinMedidasDe no tiene falsoPositivo", () => {
    expect(evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado([prod()], { medidas: ["polos:2"] }))!.falsoPositivo).toBeNull();
  });
});

describe("evaluarMedidas: ids del diccionario equivalentes (R6.8: e27, 12/24/220 V, ip 65-68)", () => {
  const productos = [prod({ zocalo: txt("e27") })];

  it("zócalo, tensión e ip se satisfacen con el id dinámico o con el del diccionario", () => {
    const z: MedidaBanco[] = [{ clave: "zocalo", valor: "e27" }];
    expect(evaluarMedidas(caso(z), resultado(productos, { medidas: ["zocalo:e27"] }))!.hit).toBe(true);
    expect(evaluarMedidas(caso(z), resultado(productos, { medidas: ["zocalo-e27"] }))!.hit).toBe(true);
    expect(evaluarMedidas(caso(z), resultado(productos, { medidas: ["zocalo-e14"] }))!.hit).toBe(false);
    const v: MedidaBanco[] = [{ clave: "tension_v", valor: 12 }];
    expect(evaluarMedidas(caso(v), resultado(productos, { medidas: ["tension-12v"] }))!.hit).toBe(true);
    expect(evaluarMedidas(caso(v), resultado(productos, { medidas: ["tension-24v"] }))!.hit).toBe(false);
    const ip: MedidaBanco[] = [{ clave: "ip", valor: 65 }];
    expect(evaluarMedidas(caso(ip), resultado(productos, { medidas: ["apto-exterior"] }))!.hit).toBe(true);
    expect(evaluarMedidas(caso([{ clave: "ip", valor: 54 }]), resultado(productos, { medidas: ["apto-exterior"] }))!.hit).toBe(false);
  });

  it("con dura:true el id (dinámico o del diccionario) tiene que estar entre los duros", () => {
    const z: MedidaBanco[] = [{ clave: "zocalo", valor: "e27", dura: true }];
    expect(evaluarMedidas(caso(z), resultado(productos, { medidas: ["zocalo-e27"], atributosDuros: [] }))!.hit).toBe(false);
    expect(evaluarMedidas(caso(z), resultado(productos, { medidas: ["zocalo-e27"], atributosDuros: ["zocalo-e27"] }))!.hit).toBe(true);
  });

  it("un id del diccionario cuenta como medida de su clave (sinMedidasDe y falsos positivos)", () => {
    const c = caso([{ clave: "potencia_w", valor: 9 }], { sinMedidasDe: ["zocalo"] });
    expect(evaluarMedidas(c, resultado(productos, { medidas: ["potencia_w:9", "zocalo-e27"] }))!.hit).toBe(false);
    expect(evaluarMedidas(caso([]), resultado(productos, { medidas: ["tension-12v"] }))!.falsoPositivo).toBe(true);
  });
});

describe("evaluarMedidas: detalle por medida esperada (con / cumple / contradice / duras)", () => {
  const conId = (id: string, p: ProductoBanco): ProductoBanco => ({ ...p, id });

  it("una entrada por medida esperada, con sus conteos sobre el top 24", () => {
    const productos = [
      prod({ polos: num(2), corriente_a: num(20) }),
      prod({ polos: num(2), corriente_a: num(20) }),
      prod({ polos: num(1), corriente_a: num(25) }),
      prod({ corriente_a: num(20) }),
    ];
    const m = evaluarMedidas(
      caso([
        { clave: "polos", valor: 2, dura: true },
        { clave: "corriente_a", valor: 20 },
      ]),
      resultado(productos),
    )!;
    expect(m.detalle).toEqual([
      { clave: "polos", valor: "2", dura: true, con: 3, cumple: 2, contradice: 1, duras: 1, inversiones: 0, arriba: 0, contradicen: [] },
      { clave: "corriente_a", valor: "20", dura: false, con: 4, cumple: 3, contradice: 1, duras: 0, inversiones: 1, arriba: 1, contradicen: [] },
    ]);
  });

  it("el valor esperado se escribe como texto: igual, rango y extremos", () => {
    const m = evaluarMedidas(
      caso([
        { clave: "zocalo", valor: "e27" },
        { clave: "potencia_w", min: 10, max: 20 },
        { clave: "potencia_w", max: 50 },
        { clave: "potencia_w", min: 20 },
      ]),
      resultado([]),
    )!;
    expect(m.detalle.map((d) => d.valor)).toEqual(["e27", "10-20", "<=50", ">=20"]);
  });

  it("contradicen lleva los ids de los productos que contradicen (los que tengan id), sólo del top 24", () => {
    const productos = [
      conId("p1", prod({ polos: num(1) })),
      conId("p2", prod({ polos: num(2) })),
      prod({ polos: num(3) }),
      ...veces(22, () => prod()),
      conId("p-fuera", prod({ polos: num(4) })),
    ];
    const m = evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado(productos))!;
    expect(m.detalle[0].contradice).toBe(2);
    expect(m.detalle[0].contradicen).toEqual(["p1"]);
  });

  it("emitidas y emitidasDuras: ids del plan y, de ésos, los que quedaron como filtro duro", () => {
    const m = evaluarMedidas(
      caso([{ clave: "polos", valor: 2 }]),
      resultado([], { medidas: ["polos:2", "corriente_a:20"], atributosDuros: ["polos:2", "otro-atributo"] }),
    )!;
    expect(m.emitidas).toEqual(["polos:2", "corriente_a:20"]);
    expect(m.emitidasDuras).toEqual(["polos:2"]);
  });

  it("la tubería sin medidas: emitidas y emitidasDuras ausentes (no es lo mismo que vacías)", () => {
    const m = evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado([]))!;
    expect(m.emitidas).toBeUndefined();
    expect(m.emitidasDuras).toBeUndefined();
  });

  it("caso negativo (medidas: []): detalle vacío pero con lo emitido", () => {
    const m = evaluarMedidas(caso([]), resultado([], { medidas: ["potencia_w:18"] }))!;
    expect(m.detalle).toEqual([]);
    expect(m.emitidas).toEqual(["potencia_w:18"]);
    expect(m.falsoPositivo).toBe(true);
  });
});

describe("ordenDeVeredictos: inversiones y contradicciones por encima del último que cumple", () => {
  it("todos los que cumplen primero: 0 inversiones, aunque contradigan varios después", () => {
    expect(ordenDeVeredictos([true, true, null, false, false])).toEqual({ inversiones: 0, arriba: 0 });
  });

  it("cuenta pares (contradice antes, cumple después)", () => {
    // F T T F T: el 1.º F está antes de 3 que cumplen; el 2.º F antes de 1.
    expect(ordenDeVeredictos([false, true, true, false, true])).toEqual({ inversiones: 4, arriba: 2 });
  });

  it("los sin dato no cuentan ni como el que cumple ni como el que contradice", () => {
    expect(ordenDeVeredictos([null, false, null, true])).toEqual({ inversiones: 1, arriba: 1 });
    expect(ordenDeVeredictos([null, null])).toEqual({ inversiones: 0, arriba: 0 });
    expect(ordenDeVeredictos([])).toEqual({ inversiones: 0, arriba: 0 });
  });

  it("si nadie cumple no hay inversión: no hay a quién haber superado", () => {
    expect(ordenDeVeredictos([false, false, false])).toEqual({ inversiones: 0, arriba: 0 });
  });
});

describe("evaluarMedidas: orden (inversiones en las claves discretas)", () => {
  it("el caso de la usuaria: contradicciones entre los que cumplen se cuentan; debajo de todos, no", () => {
    const orden = [prod({ corriente_a: num(40) }), prod({ corriente_a: num(25) }), prod({ corriente_a: num(25) }), prod(), prod({ corriente_a: num(16) })];
    const m = evaluarMedidas(caso([{ clave: "corriente_a", valor: 25 }]), resultado(orden))!;
    expect(m.contradicciones).toBe(2);
    // sólo el 40 A está por encima de los que cumplen: 2 inversiones (contra los dos 25 A); el 16 A queda debajo.
    expect(m.inversiones).toBe(2);
    expect(m.contradicenArriba).toBe(1);
    expect(m.detalle[0]).toMatchObject({ inversiones: 2, arriba: 1 });
  });

  it("orden perfecto (cumplen, sin dato, contradicen): 0", () => {
    const m = evaluarMedidas(caso([{ clave: "polos", valor: 2 }]), resultado([prod({ polos: num(2) }), prod(), prod({ polos: num(1) })]))!;
    expect(m.contradicciones).toBe(1);
    expect(m.inversiones).toBe(0);
    expect(m.contradicenArriba).toBe(0);
  });

  it("suma por medida; cada medida se ordena por separado", () => {
    const productos = [prod({ polos: num(1), corriente_a: num(20) }), prod({ polos: num(2), corriente_a: num(25) })];
    const m = evaluarMedidas(
      caso([
        { clave: "polos", valor: 2 },
        { clave: "corriente_a", valor: 20 },
      ]),
      resultado(productos),
    )!;
    // polos: el 1 va antes que el 2 (1 inversión); corriente: el 20 A va primero (0).
    expect(m.detalle.map((d) => d.inversiones)).toEqual([1, 0]);
    expect(m.inversiones).toBe(1);
  });

  it("sólo las claves discretas con valor exacto: potencia, rangos y claves blandas dan null", () => {
    const productos = [prod({ potencia_w: num(5) }), prod({ potencia_w: num(9) })];
    const m = evaluarMedidas(caso([{ clave: "potencia_w", valor: 9 }]), resultado(productos))!;
    expect(m.contradicciones).toBe(1);
    expect(m.inversiones).toBeNull();
    expect(m.contradicenArriba).toBeNull();
    expect(m.detalle[0].inversiones).toBe(0);
    const rango = evaluarMedidas(caso([{ clave: "corriente_a", min: 10, max: 20 }]), resultado([prod({ corriente_a: num(40) }), prod({ corriente_a: num(15) })]))!;
    expect(rango.inversiones).toBeNull();
  });

  it("zócalo (texto) también: E14 por encima de E27", () => {
    const m = evaluarMedidas(caso([{ clave: "zocalo", valor: "e27" }]), resultado([prod({ zocalo: txt("e14") }), prod({ zocalo: txt("e27") })]))!;
    expect(m.inversiones).toBe(1);
  });

  it("sin medidas esperadas (negativo): null", () => {
    const m = evaluarMedidas(caso([]), resultado([prod({ polos: num(1) })]))!;
    expect(m.inversiones).toBeNull();
    expect(m.contradicenArriba).toBeNull();
  });
});

describe("claveDeId", () => {
  it("clave de un id dinámico o del diccionario equivalente; undefined si no es de medida", () => {
    expect(claveDeId("corriente_a:20")).toBe("corriente_a");
    expect(claveDeId("zocalo-e27")).toBe("zocalo");
    expect(claveDeId("tension-12v")).toBe("tension_v");
    expect(claveDeId("apto-exterior")).toBe("ip");
    expect(claveDeId("otro-atributo")).toBeUndefined();
  });
});
