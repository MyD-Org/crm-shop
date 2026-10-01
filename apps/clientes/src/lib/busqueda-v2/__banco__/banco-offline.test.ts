/**
 * Banco de búsquedas OFFLINE (CI): corre *Entender* con las respuestas reales
 * de Jev grabadas (`jev-grabado.json`) y el árbol de categorías del tenant de
 * prueba (sólo nombres, `arbol-grabado.json`), sin base ni red. Verifica
 * intención, categorías duras/blandas, atributos explícitos y expansiones.
 * El conteo es falso: todas las categorías tienen productos salvo las que el
 * árbol grabado marca vacías.
 */
import { describe, expect, it } from "vitest";
import { entender } from "../entender/entender";
import type { PlanBusqueda } from "../plan";
import { BANCO } from "./banco";
import arbolGrabado from "./arbol-grabado.json";
import grabado from "./jev-grabado.json";
import { jevGrabado, type JevGrabado } from "./jev-grabado";

const { arbol, vacias } = arbolGrabado as {
  arbol: { id: string; parentId: string | null; nombre: string; orden: number }[];
  vacias: string[];
};
const contar = async ({ categorias }: { categorias: string[] }) => (categorias.some((c) => vacias.includes(c)) ? 0 : 50);
const jev = jevGrabado(grabado as JevGrabado);

async function planes(): Promise<Map<string, PlanBusqueda>> {
  const salida = new Map<string, PlanBusqueda>();
  for (const b of BANCO) {
    const r = await entender(b.q, { arbol, jev, contar });
    if (r) salida.set(b.q, r.plan);
  }
  return salida;
}

describe("banco offline (Entender con Jev grabado)", async () => {
  const porQ = await planes();
  const plan = (q: string) => porQ.get(q)!;

  it("todas las búsquedas producen un plan", () => {
    expect(porQ.size).toBe(BANCO.length);
  });

  it("intención: al menos 85 % de acierto", () => {
    const conIntencion = BANCO.filter((b) => b.intencion);
    const ok = conIntencion.filter((b) => plan(b.q).intencion === b.intencion);
    expect(ok.length / conIntencion.length).toBeGreaterThanOrEqual(0.85);
  });

  it("categoría (dura o la blanda principal): al menos 85 % de acierto", () => {
    const conCategoria = BANCO.filter((b) => b.categoria?.length);
    const ok = conCategoria.filter((b) => {
      const p = plan(b.q);
      return [...p.duros.categorias, ...p.blandos.categorias.slice(0, 1).map((c) => c.nombre)].some((c) => b.categoria!.includes(c));
    });
    expect(ok.length / conCategoria.length).toBeGreaterThanOrEqual(0.85);
  });

  it.each(BANCO.filter((b) => b.atributosDuros?.length))("atributos explícitos duros: $q", (b) => {
    expect(plan(b.q).duros.atributos).toEqual(expect.arrayContaining(b.atributosDuros!));
  });

  it.each(BANCO.filter((b) => b.expande?.length))("expansiones: $q", (b) => {
    const terminos = plan(b.q).blandos.terminos.map((t) => t.texto);
    for (const e of b.expande!) expect(terminos.some((t) => t.startsWith(e) || e.startsWith(t))).toBe(true);
  });

  it.each(BANCO.filter((b) => b.sinDuros))("sin categorías duras: $q", (b) => {
    expect(plan(b.q).duros.categorias).toEqual([]);
  });

  it("una categoría dura siempre tiene productos (nunca una vacía)", () => {
    for (const p of porQ.values()) for (const c of p.duros.categorias) expect(vacias).not.toContain(c);
  });
});
