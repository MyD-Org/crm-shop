/**
 * Tubería de la búsqueda v2 para el banco en vivo: Entender (con Jev grabado o
 * en vivo), el destino de `/buscar` y la primera página del catálogo con el
 * plan, igual que `/catalogo?…&ia=1`. SOLO scripts.
 */
import { getPaginaCatalogo, type FiltrosCatalogo } from "@/lib/catalog";
import { filtrosDeEstado, leerEstado, type EstadoCatalogo } from "@/lib/catalogo-url";
import type { NodoArbol } from "@/lib/busqueda-inteligente/tipos";
import { contador } from "../conteo";
import { criterioDe, estadoConPlan } from "../destino";
import { entender, type ClienteJev } from "../entender/entender";
import { PESO_MINIMO_RECUPERAR, type PlanBusqueda } from "../plan";
import type { ResultadoBanco } from "./banco";

export interface ContextoV2 {
  arbol: NodoArbol[];
  jev: ClienteJev | null;
  estructurados: boolean;
}

async function primera(estado: EstadoCatalogo, estructurados: boolean, plan?: PlanBusqueda) {
  const filtros: FiltrosCatalogo = {
    ...filtrosDeEstado(estado),
    ...(estructurados ? { atributosEstructurados: true } : {}),
    ...(plan ? { planBusqueda: criterioDe(plan, estado) } : {}),
  };
  return getPaginaCatalogo({ filtros, orden: estado.orden, pagina: 1, soloVisibles: false });
}

export async function ejecutarV2(q: string, ctx: ContextoV2): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const base = leerEstado({ q, stock: "todos" });
  const contar = contador({ soloVisibles: false, soloStock: false, estructurados: ctx.estructurados });
  const entendido = await entender(q, { arbol: ctx.arbol, jev: ctx.jev, contar });
  if (!entendido || entendido.plan.intencion === "codigo") {
    const p = await primera(base, ctx.estructurados);
    return {
      intencion: entendido?.plan.intencion,
      categoriasDuras: [],
      categoriasBlandas: [],
      atributosDuros: [],
      expansiones: [],
      productos: p.productos,
      total: p.total,
      ms: Date.now() - inicio,
    };
  }
  const { plan } = entendido;
  const p = await primera(estadoConPlan(base, plan), ctx.estructurados, plan);
  return {
    intencion: plan.intencion,
    categoriasDuras: plan.duros.categorias,
    categoriasBlandas: plan.blandos.categorias.map((c) => c.nombre),
    atributosDuros: plan.duros.atributos,
    expansiones: plan.blandos.terminos.filter((t) => t.peso < 1 && t.peso >= PESO_MINIMO_RECUPERAR).map((t) => t.texto),
    productos: p.productos,
    total: p.total,
    ms: Date.now() - inicio,
  };
}
