/**
 * Medidas contra el banco OFFLINE (CI, sin base ni red): Entender determinista (sin Jev) sobre el árbol
 * grabado, con conteos falsos (todo tiene 50 productos y cobertura del 90 %), y `aplicarMedidas` encima.
 * Mide el lado del PLAN (qué ids de medida produce); la precisión y las contradicciones sobre productos
 * reales las mide el banco en vivo (`--medidas=si|no`). Con las medidas apagadas el plan es idéntico.
 *
 * Los casos de UN solo token ("20a", "9w", "e27"...) ya no los corta `pareceCodigo` (M1c): llegan al
 * plan y producen sus medidas como cualquier otra consulta.
 */
import { describe, expect, it } from "vitest";
import { entender } from "../entender/entender";
import { aplicarMedidasConIds, type DepsMedidas } from "../entender/medidas-plan";
import type { PlanBusqueda } from "../plan";
import arbolGrabado from "./arbol-grabado.json";
import { BANCO } from "./banco";
import { evaluarMedidas } from "./medida-oraculo";

const { arbol } = arbolGrabado as { arbol: { id: string; parentId: string | null; nombre: string; orden: number }[] };

const deps = (activo: boolean): DepsMedidas => ({
  activo,
  estructurados: true,
  contar: async () => 50,
  contarPositivo: async () => 50,
  cobertura: async () => ({ con: 90, total: 100 }),
});

async function planDe(q: string): Promise<PlanBusqueda> {
  const r = await entender(q, { arbol, jev: null, contar: async () => 50 });
  return r!.plan;
}

const conExpectativa = BANCO.filter((b) => b.medidas !== undefined || b.sinMedidasDe?.length);
const negativos = BANCO.filter((b) => b.medidas?.length === 0);

describe("banco offline: medidas (el plan produce lo esperado)", () => {
  it("el banco trae casos de medidas", () => {
    expect(conExpectativa.length).toBeGreaterThanOrEqual(40);
    expect(negativos.length).toBeGreaterThanOrEqual(6);
  });

  it("los negativos (códigos, '2x20', '14w/m', 'caño 20mm'...) no producen ninguna medida", async () => {
    for (const b of negativos) {
      const { ids, plan } = await aplicarMedidasConIds(await planDe(b.q), b.q, deps(true));
      expect(ids, b.q).toEqual([]);
      expect(plan.duros.atributos.some((id) => id.includes(":")), b.q).toBe(false);
    }
  });

  it("todo caso con medidas esperadas las produce (con `dura:true` entre los duros), también los de un solo token", async () => {
    const falla: string[] = [];
    for (const b of conExpectativa.filter((c) => c.medidas?.some((m) => m.valor !== undefined || (m.min !== undefined && m.max !== undefined)))) {
      const base = await planDe(b.q);
      const { plan, ids } = await aplicarMedidasConIds(base, b.q, deps(true));
      const ev = evaluarMedidas(b, { intencion: plan.intencion, categoriasDuras: plan.duros.categorias, categoriasBlandas: [], atributosDuros: plan.duros.atributos, expansiones: [], productos: [], total: 0, medidas: ids });
      if (ev?.hit === true) continue;
      falla.push(b.q);
    }
    expect(falla).toEqual([]);
    // M1c (gate): los tokens-medida puros ya llegan al plan.
    for (const q of ["20a", "9w", "e27", "ip65", "6ka", "4000k"]) {
      expect(conExpectativa.some((b) => b.q === q), q).toBe(true);
    }
  });

  it("'cable unipolar 2.5 mm' y 'cable 3x2,5mm2' no emiten polos ni corriente (sinMedidasDe)", async () => {
    for (const q of ["cable unipolar 2.5 mm", "cable 3x2,5mm2", "monofasico 20a"]) {
      const b = BANCO.find((c) => c.q === q)!;
      const { plan, ids } = await aplicarMedidasConIds(await planDe(q), q, deps(true));
      const ev = evaluarMedidas(b, { intencion: plan.intencion, categoriasDuras: [], categoriasBlandas: [], atributosDuros: plan.duros.atributos, expansiones: [], productos: [], total: 0, medidas: ids });
      expect(ev?.hit, q).toBe(true);
    }
  });

  it("las claves duras de los ejemplos de la spec van duras y potencia nunca", async () => {
    const p = async (q: string) => (await aplicarMedidasConIds(await planDe(q), q, deps(true))).plan;
    expect((await p("termica 2x20")).duros.atributos).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
    expect((await p("bipolar 20a")).duros.atributos).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
    expect((await p("diferencial 40a 30ma")).duros.atributos).toEqual(expect.arrayContaining(["corriente_a:40", "sensibilidad_ma:30"]));
    for (const q of ["lampara 9w e27", "reflector led 50w", "lampara de 10 a 20w"]) {
      expect((await p(q)).duros.atributos.some((id) => id.startsWith("potencia_w")), q).toBe(false);
    }
  });
});

describe("banco offline: con el flag apagado el plan es idéntico (todo el banco)", () => {
  it("activo:false devuelve el MISMO plan y ningún id, en todos los casos del banco", async () => {
    for (const b of BANCO) {
      const base = await planDe(b.q);
      const r = await aplicarMedidasConIds(base, b.q, deps(false));
      expect(r.plan, b.q).toBe(base);
      expect(r.ids, b.q).toEqual([]);
    }
  });

  it("las medidas sólo AGREGAN: nada de lo que traía el plan desaparece (salvo lo que contradice una medida explícita)", async () => {
    for (const b of BANCO) {
      const base = await planDe(b.q);
      const { plan } = await aplicarMedidasConIds(base, b.q, deps(true));
      expect(plan.blandos.terminos, b.q).toEqual(base.blandos.terminos);
      expect(plan.blandos.categorias, b.q).toEqual(base.blandos.categorias);
      expect(plan.duros.categorias, b.q).toEqual(base.duros.categorias);
      expect(plan.intencion, b.q).toBe(base.intencion);
    }
  });
});
