/**
 * Decisión de `/buscar?q=` (spec búsqueda v2, "Presentar"): a qué URL del
 * catálogo responder con 307. Módulo puro: el flag, el plan y el conteo
 * llegan como dependencias (el route handler pone los de verdad).
 *
 * - Sin texto: `/catalogo`.
 * - Flag `busqueda-ia` apagado, o un código ("DL-18W"): la búsqueda clásica
 *   (`/catalogo?q=…`), como siempre y sin IA.
 * - Si no: el plan (caché o Entender con Jev) EN PARALELO con el conteo de la
 *   búsqueda clásica. Un plan que no agrega nada a la clásica (sin duros, sin
 *   blandos, sin sinónimos) con resultados clásicos ⇒ la clásica: el OR de
 *   la v2 sólo sumaría ruido. Si no, `/catalogo?q=<consulta>&ia=1`: sin filtros deducidos (la
 *   categoría, los atributos y las medidas que entendió el plan ordenan en la página, no filtran).
 * - Cualquier falla: la clásica. Nunca se queda sin destino.
 */
import { hrefCatalogo, leerEstado, type EstadoCatalogo } from "../catalogo-url";
import { pareceCodigo } from "../busqueda-inteligente/gate";
import { hrefConPlan } from "./destino";
import { PESO_MINIMO_RECUPERAR, hayDuros, type Intencion, type PlanBusqueda } from "./plan";
import type { PlanObtenido } from "./servidor";

/** Lo que `/buscar` le deja a la página para el evento `busqueda_enviada` (sin la consulta). */
export interface ResumenBusqueda {
  intencion: Intencion;
  fuente: PlanBusqueda["fuente"];
  duros: number;
  blandos: number;
  ms_jev: number | null;
}

export interface DepsBuscar {
  habilitada: () => Promise<boolean>;
  plan: (q: string, base: EstadoCatalogo) => Promise<PlanObtenido | null>;
  contarClasica: (base: EstadoCatalogo) => Promise<number>;
}

/** ¿El plan agrega algo a la búsqueda clásica? */
export function aportaAlgo(plan: PlanBusqueda): boolean {
  return (
    hayDuros(plan) ||
    plan.blandos.categorias.length > 0 ||
    plan.blandos.atributos.length > 0 ||
    plan.blandos.terminos.some((t) => t.peso < 1 && t.peso >= PESO_MINIMO_RECUPERAR)
  );
}

export async function destinoDeBusqueda(
  params: { q?: string | null; stock?: string | null },
  deps: DepsBuscar,
): Promise<{ href: string; resumen?: ResumenBusqueda }> {
  const base = leerEstado({ q: params.q ?? undefined, stock: params.stock ?? undefined });
  const clasica = hrefCatalogo(base);
  const q = base.query;
  if (!q) return { href: "/catalogo" };
  if (pareceCodigo(q) || !(await deps.habilitada().catch(() => false))) return { href: clasica };
  const [obtenido, total] = await Promise.all([
    deps.plan(q, base).catch(() => null),
    deps.contarClasica(base).catch(() => 0),
  ]);
  if (!obtenido) return { href: clasica };
  const { plan, msJev } = obtenido;
  if (plan.intencion === "codigo" || (!aportaAlgo(plan) && total > 0)) return { href: clasica };
  return {
    // La URL lleva lo que escribió ESTE visitante (el plan puede venir de la caché de otro).
    href: hrefConPlan(base, { ...plan, consulta: q }),
    resumen: {
      intencion: plan.intencion,
      fuente: plan.fuente,
      duros: plan.duros.categorias.length + plan.duros.atributos.length,
      blandos: plan.blandos.categorias.length + plan.blandos.atributos.length,
      ms_jev: msJev,
    },
  };
}
