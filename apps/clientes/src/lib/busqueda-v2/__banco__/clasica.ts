/**
 * Tuberías PURAS de la línea base: la búsqueda `clasica` (AND de coincidencias
 * parciales por palabra) y la `tolerante` (contiene OR similitud de trigramas
 * por término), cada una sola. Son `getPaginaCatalogo` con los filtros
 * mínimos: sin plan, sin interpretación, sin Jev, sin redirección y sin segundo
 * intento. Miden lo que corre el buscador del header, los códigos y el
 * autocompletado. SOLO scripts; cero SQL propio (reusa `coincideTexto` y
 * `relevanciaSql` de catalog.ts).
 */
import { getPaginaCatalogo } from "@/lib/catalog";
import { filtrosDeEstado } from "@/lib/catalogo-url";
import type { ResultadoBanco } from "./banco";
import { VISTA_ACTUAL, estadoBase, type VistaBanco } from "./vista";

export interface ContextoClasica {
  /** Por defecto `VISTA_ACTUAL`. */
  vista?: VistaBanco;
}

export async function ejecutarClasica(
  q: string,
  ctx: ContextoClasica,
  { tolerante }: { tolerante: boolean },
): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const vista = ctx.vista ?? VISTA_ACTUAL;
  const estado = estadoBase(q, vista);
  const p = await getPaginaCatalogo({
    filtros: { ...filtrosDeEstado(estado), ...(tolerante ? { busquedaTolerante: true } : {}) },
    orden: estado.orden,
    pagina: 1,
    soloVisibles: vista.soloVisibles,
  });
  return {
    intencion: undefined,
    categoriasDuras: [],
    categoriasBlandas: [],
    atributosDuros: [],
    expansiones: [],
    productos: p.productos,
    total: p.total,
    ms: Date.now() - inicio,
  };
}
