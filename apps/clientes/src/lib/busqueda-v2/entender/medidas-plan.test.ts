import { describe, expect, it, vi } from "vitest";
import { atributoPorId, cumpleEstructurado } from "../../catalogo-atributos";
import { esMedidaId } from "../../catalogo-atributos-medida";
import type { AtributosEstructurados } from "../../catalogo-caracteristicas";
import { PUNTOS } from "../ordenar";
import { planVacio, type Intencion, type PlanBusqueda } from "../plan";
import {
  MINIMO_MEDIDA_DURA,
  MINIMO_PRODUCTOS_COBERTURA,
  PESO_MEDIDA_BLANDA,
  PESO_MEDIDA_DURA,
  PESO_POTENCIA_BANDA,
  PESO_POTENCIA_EXACTA,
  POLITICA,
  TOPE_BLANDOS_MEDIDA,
  UMBRAL_COBERTURA_DURA,
  aplicarMedidas,
  aplicarMedidasConIds,
  coberturaConContar,
  type DepsMedidas,
} from "./medidas-plan";

/**
 * Plan base de un test: la consulta, sus términos (los de más de 1 son "de orden", peso 0,4, como los
 * que llevan dígitos) y lo que se quiera pisar. `fuertes` = términos que RECUPERAN (ancla de universo).
 */
function plan(consulta: string, fuertes: string[], extra: Partial<PlanBusqueda> = {}, debiles: string[] = []): PlanBusqueda {
  const base = planVacio(consulta);
  return {
    ...base,
    blandos: {
      ...base.blandos,
      terminos: [...fuertes.map((texto) => ({ texto, peso: 1 })), ...debiles.map((texto) => ({ texto, peso: 0.4 }))],
    },
    ...extra,
  };
}

interface Espias {
  contar: ReturnType<typeof vi.fn>;
  contarPositivo: ReturnType<typeof vi.fn>;
  cobertura: ReturnType<typeof vi.fn>;
}

function deps(sobre: Partial<DepsMedidas> = {}): DepsMedidas & Espias {
  const contar = vi.fn(async () => 50);
  const contarPositivo = vi.fn(async () => 50);
  const cobertura = vi.fn(async () => ({ con: 90, total: 100 }));
  return { activo: true, estructurados: true, contar, contarPositivo, cobertura, ...sobre } as DepsMedidas & Espias;
}

const blandosDe = (p: PlanBusqueda) => Object.fromEntries(p.blandos.atributos.map((a) => [a.id, a.peso]));

describe("constantes", () => {
  it("umbrales de la spec", () => {
    expect(UMBRAL_COBERTURA_DURA).toBe(0.8);
    expect(MINIMO_PRODUCTOS_COBERTURA).toBe(20);
    expect(MINIMO_MEDIDA_DURA).toBe(3);
    expect(PESO_POTENCIA_EXACTA).toBe(0.5);
    expect(PESO_POTENCIA_BANDA).toBe(0.5);
    expect(PESO_MEDIDA_BLANDA).toBe(0.9);
    expect(PESO_MEDIDA_DURA).toBe(1);
    expect(TOPE_BLANDOS_MEDIDA).toBe(6);
  });
});

describe("aplicarMedidas: lo que no toca", () => {
  it("activo:false devuelve el MISMO plan y no cuenta nada", async () => {
    const d = deps({ activo: false });
    const p = plan("termica 2x20", ["termica"], {}, ["2x20"]);
    expect(await aplicarMedidas(p, "termica 2x20", d)).toBe(p);
    expect(d.contar).not.toHaveBeenCalled();
    expect(d.contarPositivo).not.toHaveBeenCalled();
    expect(d.cobertura).not.toHaveBeenCalled();
  });

  it("intención codigo: plan idéntico", async () => {
    const p = planVacio("20a", "codigo");
    expect(await aplicarMedidas(p, "20a", deps())).toBe(p);
  });

  it("sin medidas en la consulta: plan idéntico y sin conteos", async () => {
    const d = deps();
    const p = plan("reflector patio", ["reflector", "patio"]);
    expect(await aplicarMedidas(p, "reflector patio", d)).toEqual(p);
    expect(d.contar).not.toHaveBeenCalled();
  });

  it("no muta el plan de entrada", async () => {
    const p = plan("termica 2x20", ["termica"], {}, ["2x20"]);
    const copia = structuredClone(p);
    await aplicarMedidas(p, "termica 2x20", deps());
    expect(p).toEqual(copia);
  });

  it("pregunta: sin duros (las blandas sí)", async () => {
    const r = await aplicarMedidas(plan("sirve una termica 2x20?", ["termica"], { intencion: "pregunta" as Intencion }, ["2x20"]), "sirve una termica 2x20?", deps());
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)["polos:2"]).toBe(0.9);
    expect(blandosDe(r)["corriente_a:20"]).toBe(0.9);
  });

  it("sin atributos estructurados: sin duros", async () => {
    const d = deps({ estructurados: false });
    const r = await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", d);
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)["polos:2"]).toBe(0.9);
    expect(d.contar).not.toHaveBeenCalled();
  });

  it("strip idempotente: los ids de medida que ya traía el plan se quitan y se recalculan", async () => {
    const sembrado = plan("reflector patio", ["reflector"], {
      duros: { categorias: [], atributos: ["corriente_a:99", "tono-calido"] },
      blandos: { categorias: [], atributos: [{ id: "polos:3", peso: 1 }, { id: "tono-calido", peso: 0.9 }], terminos: [{ texto: "reflector", peso: 1 }] },
    });
    const una = await aplicarMedidas(sembrado, "reflector patio", deps());
    expect(una.duros.atributos).toEqual(["tono-calido"]);
    expect(una.blandos.atributos).toEqual([{ id: "tono-calido", peso: 0.9 }]);
    expect(await aplicarMedidas(una, "reflector patio", deps())).toEqual(una);
  });

  it("error en un conteo: devuelve el plan y avisa sólo el tipo del error, nunca la consulta", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ contar: vi.fn(async () => { throw new TypeError("base caída: consulta secreta"); }) });
    const p = plan("termica 2x20", ["termica"], {}, ["2x20"]);
    const r = await aplicarMedidas(p, "termica 2x20", d);
    expect(r).toEqual(p);
    expect(aviso).toHaveBeenCalledTimes(1);
    const texto = String(aviso.mock.calls[0]);
    expect(texto).toContain("TypeError");
    expect(texto).not.toContain("termica");
    expect(texto).not.toContain("secreta");
    aviso.mockRestore();
  });
});

describe("aplicarMedidas: política por clave (R6.2)", () => {
  it("termica 2x20 con ancla y cobertura alta: polos y corriente DURAS y también blandas con peso 1", async () => {
    const r = await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", deps());
    expect(r.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    expect(blandosDe(r)).toMatchObject({ "polos:2": 1, "corriente_a:20": 1 });
  });

  it("los términos no cambian: 2x20 sigue como término de orden 0,4 (C10)", async () => {
    const p = plan("termica 2x20", ["termica"], {}, ["2x20"]);
    const r = await aplicarMedidas(p, "termica 2x20", deps());
    expect(r.blandos.terminos).toEqual(p.blandos.terminos);
    expect(r.blandos.categorias).toEqual(p.blandos.categorias);
  });

  it("confianza media nunca es dura: 'termica 20' va a blandos", async () => {
    const r = await aplicarMedidas(plan("termica 20", ["termica"], {}, ["20"]), "termica 20", deps());
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)).toEqual({ "corriente_a:20": 0.9 });
  });

  it("confianza baja no emite: 'lampara 9' no trae ningún id de potencia", async () => {
    const r = await aplicarMedidas(plan("lampara 9", ["lampara"], {}, ["9"]), "lampara 9", deps());
    expect(r.blandos.atributos.some((a) => a.id.startsWith("potencia_w"))).toBe(false);
    expect(r.duros.atributos).toEqual([]);
    expect(r.blandos.terminos).toContainEqual({ texto: "9", peso: 0.4 });
  });

  it("potencia nunca es dura", async () => {
    const r = await aplicarMedidas(plan("lampara 9w", ["lampara"], {}, ["9w"]), "lampara 9w", deps());
    expect(r.duros.atributos).toEqual([]);
    expect(POLITICA.potencia_w.duro).toBe(false);
  });

  it("zócalo con cobertura de Iluminación (30,5 %) va a blandos", async () => {
    const d = deps({ cobertura: vi.fn(async () => ({ con: 305, total: 1000 })) });
    const r = await aplicarMedidas(plan("lampara g9", ["lampara"], { duros: { categorias: ["ILUMINACION"], atributos: [] } }, ["g9"]), "lampara g9", d);
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)).toMatchObject({ "zocalo:g9": 0.9 });
  });

  it.each([
    [16, 20, true],
    [15, 19, false], // 19 productos: muestra insuficiente aunque cubra el 100 % (aquí 78,9 %)
    [19, 19, false],
    [79, 100, false],
    [80, 100, true],
  ])("cobertura %i de %i: dura=%s", async (con, total, dura) => {
    const d = deps({ cobertura: vi.fn(async () => ({ con, total })) });
    const r = await aplicarMedidas(plan("termica 20a", ["termica"], {}, ["20a"]), "termica 20a", d);
    expect(r.duros.atributos).toEqual(dura ? ["corriente_a:20"] : []);
    expect(blandosDe(r)["corriente_a:20"]).toBe(dura ? PESO_MEDIDA_DURA : PESO_MEDIDA_BLANDA);
  });

  it("la cobertura se mide sobre el universo del plan (categoría dura + términos fuertes), sin las medidas", async () => {
    const d = deps();
    await aplicarMedidas(plan("termica 2x20", ["termica"], { duros: { categorias: ["Termomagneticas"], atributos: [] } }, ["2x20"]), "termica 2x20", d);
    const universo = { categorias: ["Termomagneticas"], atributos: [], terminos: ["termica"] };
    expect(d.cobertura).toHaveBeenCalledWith(universo, "polos");
    expect(d.cobertura).toHaveBeenCalledWith(universo, "corriente_a");
  });

  it("una clave sin cobertura degrada sola; las demás se quedan duras", async () => {
    const d = deps({ cobertura: vi.fn(async (_u, clave) => (clave === "polos" ? { con: 10, total: 100 } : { con: 94, total: 100 })) });
    const r = await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", d);
    expect(r.duros.atributos).toEqual(["corriente_a:20"]);
    expect(blandosDe(r)).toMatchObject({ "polos:2": 0.9, "corriente_a:20": 1 });
  });

  it("tensión e IP son blandas en esta etapa", async () => {
    const t = await aplicarMedidas(plan("tira 48v", ["tira"], {}, []), "tira 48v", deps());
    expect(t.duros.atributos).toEqual([]);
    expect(blandosDe(t)).toEqual({ "tension_v:48": 0.9 });
    const ip = await aplicarMedidas(plan("proyector ip44", ["proyector"], {}, []), "proyector ip44", deps());
    expect(ip.duros.atributos).toEqual([]);
    expect(blandosDe(ip)).toEqual({ "ip:44": 0.9 });
  });

  it("la tabla de política (cambiar una clave de modo obliga a actualizar este test)", () => {
    expect(POLITICA).toEqual({
      polos: { duro: true },
      corriente_a: { duro: true },
      sensibilidad_ma: { duro: true },
      zocalo: { duro: true },
      tension_v: { duro: false },
      ip: { duro: false },
      potencia_w: { duro: false, tolerancia: "potencia" },
      flujo_lm: { duro: false },
      temperatura_k: { duro: false },
      curva: { duro: false },
      seccion_mm2: { duro: false },
      largo_m: { duro: false },
      poder_corte_ka: { duro: false },
      angulo_grados: { duro: false },
      medidas_mm: { duro: false },
    });
  });
});

describe("aplicarMedidas: semántica y guard (C1, C14)", () => {
  it("con ancla: n1 = conteo del conjunto con las medidas y n2 = conteo positivo", async () => {
    const d = deps();
    await aplicarMedidas(plan("termica 2x20", ["termica"], { duros: { categorias: ["Termomagneticas"], atributos: ["tono-calido"] } }, ["2x20"]), "termica 2x20", d);
    const filtros = { categorias: ["Termomagneticas"], atributos: ["tono-calido", "polos:2", "corriente_a:20"], terminos: ["termica"] };
    expect(d.contar).toHaveBeenCalledWith(filtros);
    expect(d.contarPositivo).toHaveBeenCalledWith(filtros);
  });

  it("con ancla: n1 < 3 degrada TODAS las medidas a blando (todo o nada)", async () => {
    const d = deps({ contar: vi.fn(async () => 2) });
    const r = await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", d);
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)).toEqual({ "polos:2": 0.9, "corriente_a:20": 0.9 });
  });

  it("con ancla: n1 = 3 alcanza", async () => {
    const d = deps({ contar: vi.fn(async () => MINIMO_MEDIDA_DURA) });
    const r = await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", d);
    expect(r.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
  });

  it("con ancla: ningún producto que SÍ cumpla (n2 = 0) degrada ('termica 2x20' sin ningún 20 A)", async () => {
    const d = deps({ contarPositivo: vi.fn(async () => 0) });
    const r = await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", d);
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)).toEqual({ "polos:2": 0.9, "corriente_a:20": 0.9 });
  });

  it("con ancla: n2 = 1 alcanza", async () => {
    const d = deps({ contarPositivo: vi.fn(async () => 1) });
    expect((await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", d)).duros.atributos).toHaveLength(2);
  });

  it("la categoría BLANDA no es ancla: solo cuentan las duras y los términos fuertes (C1)", async () => {
    const soloBlanda = plan("bipolar 20a", [], { blandos: { categorias: [{ nombre: "Termomagneticas", peso: 0.8 }], atributos: [], terminos: [{ texto: "20a", peso: 0.4 }] } });
    const d = deps();
    const r = await aplicarMedidas(soloBlanda, "bipolar 20a", d);
    // Sin ancla: modo positivo (no se mira la cobertura, que mide la ausencia de dato).
    expect(d.cobertura).not.toHaveBeenCalled();
    expect(d.contarPositivo).toHaveBeenCalledWith({ categorias: [], atributos: ["polos:2", "corriente_a:20"], terminos: [] });
    expect(r.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
  });

  it("sin ancla ('bipolar 20a' sólo medidas): duro positivo si hay >= 3 que cumplen", async () => {
    const d = deps();
    const r = await aplicarMedidas(plan("bipolar 20a", [], {}, ["20a"]), "bipolar 20a", d);
    expect(r.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    expect(d.contar).not.toHaveBeenCalled();
  });

  it("sin ancla: menos de 3 que cumplen => blando, nunca devuelve el catálogo entero", async () => {
    const d = deps({ contarPositivo: vi.fn(async () => 2) });
    const r = await aplicarMedidas(plan("bipolar 20a", [], {}, ["20a"]), "bipolar 20a", d);
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)).toEqual({ "polos:2": 0.9, "corriente_a:20": 0.9 });
  });

  it("la ancla es la misma que la de la página: categoría dura o términos fuertes (universoAcotado)", async () => {
    const conCategoria = deps();
    await aplicarMedidas(plan("bipolar 20a", [], { duros: { categorias: ["Termomagneticas"], atributos: [] } }, ["20a"]), "bipolar 20a", conCategoria);
    expect(conCategoria.contar).toHaveBeenCalled();
    expect(conCategoria.contarPositivo).toHaveBeenCalled();
  });

  it("los duros ya presentes en el plan (diccionario) viajan en el conteo del conjunto", async () => {
    const d = deps();
    await aplicarMedidas(plan("lampara e27 20w", ["lampara"], { duros: { categorias: [], atributos: ["zocalo-e27"] } }, ["20w"]), "lampara e27 20w", d);
    // potencia nunca es dura: no hay candidatas, no hay conteo de conjunto.
    expect(d.contar).not.toHaveBeenCalled();
  });
});

describe("aplicarMedidas: diccionario y merge (R6.7, R6.8)", () => {
  it("'lampara e27': emite el id del diccionario (blando 0,9), no zocalo:e27", async () => {
    const r = await aplicarMedidas(plan("lampara e27", ["lampara", "e27"]), "lampara e27", deps());
    expect(blandosDe(r)).toEqual({ "zocalo-e27": 0.9 });
    expect(r.blandos.atributos.some((a) => a.id === "zocalo:e27")).toBe(false);
    expect(r.duros.atributos).toEqual([]);
  });

  it("'tira 12v': el del diccionario, una sola vez si ya estaba en los duros", async () => {
    const p = plan("tira 12v", ["tira"], { duros: { categorias: [], atributos: ["tension-12v"] } });
    const r = await aplicarMedidas(p, "tira 12v", deps());
    expect(r.duros.atributos).toEqual(["tension-12v"]);
    expect(r.blandos.atributos).toEqual([]);
  });

  it("no duplica si ya estaba en los blandos (conserva el mayor peso)", async () => {
    const p = plan("tira 12v", ["tira"], { blandos: { categorias: [], atributos: [{ id: "tension-12v", peso: 0.95 }], terminos: [{ texto: "tira", peso: 1 }] } });
    const r = await aplicarMedidas(p, "tira 12v", deps());
    expect(r.blandos.atributos).toEqual([{ id: "tension-12v", peso: 0.95 }]);
  });

  it("230 V y 220 V comparten tension-220v", async () => {
    expect(blandosDe(await aplicarMedidas(plan("lampara 230v", ["lampara"]), "lampara 230v", deps()))).toEqual({ "tension-220v": 0.9 });
  });

  it.each([
    ["ip65", true],
    ["ip66", true],
    ["ip68", true],
    ["ip54", false],
    ["ip69", false],
  ])("%s: apto-exterior=%s (el resto es dinámico)", async (ip, exterior) => {
    const r = await aplicarMedidas(plan(`proyector ${ip}`, ["proyector"]), `proyector ${ip}`, deps());
    const ids = r.blandos.atributos.map((a) => a.id);
    expect(ids.includes("apto-exterior")).toBe(exterior);
    expect(ids.some((id) => id.startsWith("ip:"))).toBe(!exterior);
  });

  it("'termica 2x20' y 'diferencial 30ma' emiten dinámicos (el diccionario no los tiene)", async () => {
    const t = await aplicarMedidas(plan("termica 2x20", ["termica"], {}, ["2x20"]), "termica 2x20", deps());
    expect(t.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    const d = await aplicarMedidas(plan("diferencial 30ma", ["diferencial"], {}, ["30ma"]), "diferencial 30ma", deps());
    expect(d.duros.atributos).toEqual(["sensibilidad_ma:30"]);
  });

  it("Jev trajo 24 V y la consulta dice 12v: queda solo 12 V (la medida explícita prevalece)", async () => {
    const p = plan("tira 12v", ["tira"], {
      duros: { categorias: [], atributos: ["tension-24v"] },
      blandos: { categorias: [], atributos: [{ id: "tension-24v", peso: 0.9 }, { id: "tono-calido", peso: 0.6 }], terminos: [{ texto: "tira", peso: 1 }] },
    });
    const r = await aplicarMedidas(p, "tira 12v", deps());
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)).toEqual({ "tono-calido": 0.6, "tension-12v": 0.9 });
  });

  it("una medida de confianza media no desplaza lo que trajo el plan", async () => {
    const p = plan("termica 20", ["termica"], { blandos: { categorias: [], atributos: [], terminos: [{ texto: "termica", peso: 1 }] } });
    const r = await aplicarMedidas(p, "termica 20", deps());
    expect(blandosDe(r)).toEqual({ "corriente_a:20": 0.9 });
  });

  it("dos valores de la misma clave: el parser no emite ninguno", async () => {
    const r = await aplicarMedidas(plan("termica 20a 25a", ["termica"]), "termica 20a 25a", deps());
    expect(r.blandos.atributos).toEqual([]);
    expect(r.duros.atributos).toEqual([]);
  });
});

describe("aplicarMedidas: potencia y ordenamiento (R6.5)", () => {
  const productos: Record<string, AtributosEstructurados> = {
    P1: { potencia_w: { n: 9, t: null } },
    P2: { potencia_w: { n: 10, t: null } },
    P3: { potencia_w: { n: 8.5, t: null } },
    P4: { potencia_w: { n: 15, t: null } },
    P5: {},
  };

  /** Lo que suma `puntajeBusqueda` por los atributos blandos (PUNTOS.atributo × peso), evaluado en JS. */
  const puntos = (p: PlanBusqueda, producto: AtributosEstructurados) =>
    p.blandos.atributos.reduce((suma, a) => {
      const est = atributoPorId(a.id)?.estructurado;
      return suma + (est && cumpleEstructurado(est, producto[est.clave]) === true ? PUNTOS.atributo * a.peso : 0);
    }, 0);

  it("'lampara 9w': par exacto + banda (±1 W bajo 10 W), cada uno con peso 0,5", async () => {
    const r = await aplicarMedidas(plan("lampara 9w", ["lampara"], {}, ["9w"]), "lampara 9w", deps());
    expect(r.blandos.atributos).toEqual([
      { id: "potencia_w:9", peso: PESO_POTENCIA_EXACTA },
      { id: "potencia_w:8-10", peso: PESO_POTENCIA_BANDA },
    ]);
    expect(r.duros.atributos).toEqual([]);
  });

  it("puntos contra PUNTOS.atributo: dentro de la banda y exacto +3; sólo banda +1,5", () => {
    expect(PUNTOS.atributo * (PESO_POTENCIA_EXACTA + PESO_POTENCIA_BANDA)).toBe(3);
    expect(PUNTOS.atributo * PESO_POTENCIA_BANDA).toBe(1.5);
  });

  it("orden real: P1 (9 W) > P2, P3 (en la banda) > P4, P5 (sin dato) y ninguno desaparece", async () => {
    const r = await aplicarMedidas(plan("lampara 9w", ["lampara"], {}, ["9w"]), "lampara 9w", deps());
    const p = Object.fromEntries(Object.entries(productos).map(([k, v]) => [k, puntos(r, v)]));
    expect(p.P1).toBe(3);
    expect(p.P2).toBe(1.5);
    expect(p.P3).toBe(1.5);
    expect(p.P4).toBe(0);
    expect(p.P5).toBe(0);
  });

  it("no acumula: un producto de exactamente 9 W suma +3, no +4,5", async () => {
    const r = await aplicarMedidas(plan("lampara 9w", ["lampara"], {}, ["9w"]), "lampara 9w", deps());
    expect(puntos(r, productos.P1)).toBe(3);
  });

  it("'lampara 20w': banda ±10 % = 18 a 22 W (+1,5) y 20 W +3", async () => {
    const r = await aplicarMedidas(plan("lampara 20w", ["lampara"], {}, ["20w"]), "lampara 20w", deps());
    expect(r.blandos.atributos).toEqual([
      { id: "potencia_w:20", peso: 0.5 },
      { id: "potencia_w:18-22", peso: 0.5 },
    ]);
    expect(puntos(r, { potencia_w: { n: 20, t: null } })).toBe(3);
    expect(puntos(r, { potencia_w: { n: 18, t: null } })).toBe(1.5);
    expect(puntos(r, { potencia_w: { n: 22, t: null } })).toBe(1.5);
    expect(puntos(r, { potencia_w: { n: 22.5, t: null } })).toBe(0);
  });

  it("potencia con decimales y valores chicos dan ids válidos", async () => {
    const r = await aplicarMedidas(plan("lampara 9,5w", ["lampara"], {}, ["9", "5w"]), "lampara 9,5w", deps());
    expect(r.blandos.atributos.map((a) => a.id)).toEqual(["potencia_w:9.5", "potencia_w:8.5-10.5"]);
    const chica = await aplicarMedidas(plan("led 0,5w", ["led"]), "led 0,5w", deps());
    expect(chica.blandos.atributos.every((a) => esMedidaId(a.id))).toBe(true);
  });

  it("rango explícito '10 a 20w': una banda blanda, sin filtro duro", async () => {
    const r = await aplicarMedidas(plan("lampara de 10 a 20w", ["lampara"], {}, ["10", "20w"]), "lampara de 10 a 20w", deps());
    expect(r.blandos.atributos).toEqual([{ id: "potencia_w:10-20", peso: 0.5 }]);
    expect(r.duros.atributos).toEqual([]);
  });

  it("comparadores ('hasta 50w', 'hasta 32a') no emiten (sin id; lo cubre M4)", async () => {
    expect((await aplicarMedidas(plan("lampara hasta 50w", ["lampara"]), "lampara hasta 50w", deps())).blandos.atributos).toEqual([]);
    expect((await aplicarMedidas(plan("termica hasta 32a", ["termica"]), "termica hasta 32a", deps())).duros.atributos).toEqual([]);
  });

  it("panel 60x60: medidas_mm sólo blando, con el valor y la alternativa", async () => {
    const r = await aplicarMedidas(plan("panel 60x60", ["panel"], {}, ["60x60"]), "panel 60x60", deps());
    expect(r.duros.atributos).toEqual([]);
    expect(blandosDe(r)).toEqual({ "medidas_mm:600x600": 0.9, "medidas_mm:60x60": 0.9 });
  });

  it("tope de blandos de medida", async () => {
    const q = "termica 2x20 diferencial 30ma 5m 1,5kw 4000k 12000lm tension 48v ip44 curva c 6ka";
    const r = await aplicarMedidas(plan(q, ["termica"]), q, deps({ contar: vi.fn(async () => 1) }));
    const medidas = r.blandos.atributos.filter((a) => esMedidaId(a.id));
    expect(medidas.length).toBeLessThanOrEqual(TOPE_BLANDOS_MEDIDA);
  });

  it("todo id emitido pasa la gramática o es del diccionario", async () => {
    const q = "termica 2x20 e27 12v ip65 9,5w 30ma";
    const r = await aplicarMedidas(plan(q, ["termica"]), q, deps());
    for (const id of [...r.duros.atributos, ...r.blandos.atributos.map((a) => a.id)]) expect(atributoPorId(id), id).toBeTruthy();
  });
});

describe("aplicarMedidasConIds (para el banco)", () => {
  it("devuelve los ids de medida: dinámicos y del diccionario (estén o no ya en el plan)", async () => {
    const p = plan("lampara 9w e27", ["lampara"], { duros: { categorias: [], atributos: ["zocalo-e27"] } }, ["9w"]);
    const { plan: r, ids } = await aplicarMedidasConIds(p, "lampara 9w e27", deps());
    expect(ids).toEqual(expect.arrayContaining(["zocalo-e27", "potencia_w:9", "potencia_w:8-10"]));
    expect(r.duros.atributos).toEqual(["zocalo-e27"]);
  });

  it("con las medidas apagadas, ninguno", async () => {
    expect((await aplicarMedidasConIds(plan("termica 2x20", ["termica"]), "termica 2x20", deps({ activo: false }))).ids).toEqual([]);
  });

  it("un negativo no emite ninguno ('DL-18W')", async () => {
    expect((await aplicarMedidasConIds(plan("DL-18W", ["dl"]), "DL-18W", deps())).ids).toEqual([]);
  });
});

describe("coberturaConContar", () => {
  it("con = conteo con la clave; total = conteo del universo", async () => {
    const contar = vi.fn(async (f: { conClaves?: string[] }) => (f.conClaves ? 83 : 100));
    const cobertura = coberturaConContar(contar);
    expect(await cobertura({ categorias: ["Termomagneticas"], atributos: [], terminos: ["termica"] }, "polos")).toEqual({ con: 83, total: 100 });
    expect(contar).toHaveBeenCalledWith({ categorias: ["Termomagneticas"], atributos: [], terminos: ["termica"], conClaves: ["polos"] });
    expect(contar).toHaveBeenCalledWith({ categorias: ["Termomagneticas"], atributos: [], terminos: ["termica"] });
  });

  it("el total del mismo universo se cuenta una sola vez", async () => {
    const contar = vi.fn(async (f: { conClaves?: string[] }) => (f.conClaves ? 5 : 100));
    const cobertura = coberturaConContar(contar);
    const u = { categorias: [], atributos: [], terminos: ["x"] };
    await cobertura(u, "polos");
    await cobertura(u, "corriente_a");
    expect(contar.mock.calls.filter(([f]) => !f.conClaves)).toHaveLength(1);
  });
});

describe("consulta de SOLO medida: la medida también viaja como id dinámico (para que recupere y ordene)", () => {
  it("'ip65' (Jev/diccionario ya puso apto-exterior): suma ip:65 al diccionario", async () => {
    const base = plan("ip65", [], { blandos: { categorias: [{ nombre: "Reflectores", peso: 0.5 }], atributos: [{ id: "apto-exterior", peso: 0.9 }], terminos: [] } });
    const { plan: r, ids } = await aplicarMedidasConIds(base, "ip65", deps());
    expect(blandosDe(r)).toMatchObject({ "apto-exterior": 0.9, "ip:65": PESO_MEDIDA_BLANDA });
    expect(ids).toEqual(expect.arrayContaining(["apto-exterior", "ip:65"]));
  });

  it("'e27' y '12v' sin otro término: el id del diccionario y el dinámico", async () => {
    const e27 = await aplicarMedidas(plan("e27", []), "e27", deps());
    expect(blandosDe(e27)).toMatchObject({ "zocalo-e27": PESO_MEDIDA_BLANDA, "zocalo:e27": PESO_MEDIDA_BLANDA });
    const v12 = await aplicarMedidas(plan("12v", [], {}, ["12v"]), "12v", deps());
    expect(blandosDe(v12)).toMatchObject({ "tension-12v": PESO_MEDIDA_BLANDA, "tension_v:12": PESO_MEDIDA_BLANDA });
  });

  it("con un término que recupera ('lampara e27', 'tira 12v') sigue SIN id dinámico duplicado (R6.8)", async () => {
    const r = await aplicarMedidas(plan("lampara e27", ["lampara"]), "lampara e27", deps());
    expect(r.blandos.atributos.some((a) => a.id === "zocalo:e27")).toBe(false);
    const t = await aplicarMedidas(plan("tira 12v", ["tira"], {}, ["12v"]), "tira 12v", deps());
    expect(t.blandos.atributos.some((a) => a.id === "tension_v:12")).toBe(false);
  });

  it("'6ka' y '9w': ya traen su id dinámico (blando) y el plan los deja listos para recuperar", async () => {
    const ka = await aplicarMedidas(plan("6ka", [], {}, ["6ka"]), "6ka", deps());
    expect(blandosDe(ka)).toEqual({ "poder_corte_ka:6": PESO_MEDIDA_BLANDA });
    const w = await aplicarMedidas(plan("9w", [], {}, ["9w"]), "9w", deps());
    expect(blandosDe(w)).toEqual({ "potencia_w:9": PESO_POTENCIA_EXACTA, "potencia_w:8-10": PESO_POTENCIA_BANDA });
  });
});
