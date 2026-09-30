import { describe, expect, it, vi } from "vitest";
import { leerEstado, type EstadoCatalogo } from "../catalogo-url";
import { decidirBusqueda } from "./flujo";
import { interpretarCon, type Dependencias } from "./interpretar";
import type { PreguntaChoice, Respuestas } from "./jev";
import type { NodoArbol } from "./tipos";

const n = (id: string, nombre: string, parentId: string | null = null, orden = 0): NodoArbol => ({ id, parentId, nombre, orden });
/** Con la forma del árbol real: raíces con subcategorías. */
const ARBOL: NodoArbol[] = [
  n("r1", "ILUMINACION", null, 1),
  n("r2", "MATERIALES ELECTRICOS", null, 2),
  n("c1", "Lámparas", "r1", 1),
  n("c2", "Reflectores", "r1", 2),
  n("c3", "Luminarias exteriores", "r1", 3),
  n("c4", "Cables", "r2", 1),
  n("c5", "Térmicas", "r2", 2),
];

/** Jev simulado con respuestas seguras para la consulta del jardín. */
const jev = vi.fn(async (_c: string, preguntas: Record<string, PreguntaChoice>): Promise<Respuestas> => {
  if ("sub" in preguntas) return { sub: { choice: "luminarias_exteriores", confidence: 0.93 } };
  return {
    raiz: { choice: "iluminacion", confidence: 0.96 },
    tono: { choice: "no_especifica", confidence: 0.98 },
    ambiente: { choice: "exterior", confidence: 0.95 },
  };
});

const deps: Dependencias = { arbol: ARBOL, jev, leerCache: async () => null, guardarCache: async () => {} };

async function decidir(q: string, total: number, contar: (e: EstadoCatalogo) => Promise<number>) {
  const estado = leerEstado({ q, stock: "todos" });
  return decidirBusqueda(estado, total, await interpretarCon(q, deps), contar);
}

describe("decidirBusqueda con consultas reales", () => {
  it("'lampara para pecera de agua salada': no tira 'pecera'; el estado con residual no trae nada ⇒ no redirige y sugiere", async () => {
    const contar = vi.fn<(e: EstadoCatalogo) => Promise<number>>(async () => 0);
    const d = await decidir("lampara para pecera de agua salada", 0, contar);
    expect(d.redirigir).toBeUndefined();
    // Se contó el estado interpretado CON las palabras que importan.
    expect(contar).toHaveBeenCalledTimes(1);
    expect(contar.mock.calls[0][0]).toMatchObject({ query: "pecera salada", categorias: ["Lámparas"] });
    // Sin resultados: la interpretación como alternativa (quita la búsqueda).
    expect(d.alternativas.map((c) => c.etiqueta)).toEqual(["Lámparas"]);
    expect(d.alternativas[0].href).toBe("/catalogo?categoria=L%C3%A1mparas&stock=todos");
  });

  it("…y si el estado con residual sí trae algo, redirige conservando esas palabras", async () => {
    const d = await decidir("lampara para pecera de agua salada", 0, async () => 2);
    expect(d.redirigir).toBe(
      "/catalogo?q=pecera+salada&categoria=L%C3%A1mparas&stock=todos&ia=lampara+para+pecera+de+agua+salada",
    );
  });

  it("'reflector para el patio luz calida': redirige sin residual y sin contar", async () => {
    const contar = vi.fn(async () => 0);
    const d = await decidir("reflector para el patio luz calida", 0, contar);
    expect(d.redirigir).toBe(
      "/catalogo?categoria=Reflectores&atr=tono-calido&stock=todos&ia=reflector+para+el+patio+luz+calida",
    );
    expect(contar).not.toHaveBeenCalled();
  });

  it("'luz para el jardin que no se moje': redirige a Luminarias exteriores + Apto exterior", async () => {
    const contar = vi.fn(async () => 0);
    const d = await decidir("luz para el jardin que no se moje", 1, contar);
    expect(d.redirigir).toBe(
      "/catalogo?categoria=Luminarias+exteriores&atr=apto-exterior&stock=todos&ia=luz+para+el+jardin+que+no+se+moje",
    );
    expect(contar).not.toHaveBeenCalled();
  });

  it("sin interpretación, nada que redirigir ni sugerir", async () => {
    expect(await decidirBusqueda(leerEstado({ q: "xyz" }), 0, null, async () => 0)).toEqual({ alternativas: [], chipsFranja: [] });
  });

  it("con algún resultado y sin redirigir, la interpretación va a la franja (suma el filtro)", async () => {
    const d = await decidir("lampara para pecera de agua salada", 2, async () => 0);
    expect(d.alternativas).toEqual([]);
    expect(d.chipsFranja[0].href).toContain("q=lampara+para+pecera+de+agua+salada");
  });
});
