/**
 * Tubería de la FASE 1 (búsqueda inteligente de la spec 2026-09-29), tal como
 * la corría la page del catálogo, para la línea de base del banco. SOLO
 * scripts. Reproduce `app/catalogo/page.tsx` de esa fase sin Next:
 *
 * 1. búsqueda clásica (`?q=…&stock=todos`, como el buscador del header) y, con
 *    0 resultados, el segundo intento tolerante;
 * 2. `debeInterpretar`: con 4 o más resultados la grilla queda como está (la
 *    franja sólo sugiere); con menos, `interpretarCon` (sin caché) y
 *    `decidirBusqueda`: si redirige, la página interpretada.
 */
import { getPaginaCatalogo, type FiltrosCatalogo, type PaginaCatalogo } from "@/lib/catalog";
import { filtrosDeEstado, type EstadoCatalogo } from "@/lib/catalogo-url";
import { POCOS_RESULTADOS, debeInterpretar } from "@/lib/busqueda-inteligente/gate";
import { interpretarCon, type Dependencias } from "@/lib/busqueda-inteligente/interpretar";
import { decidirBusqueda } from "@/lib/busqueda-inteligente/flujo";
import { estadoInterpretado } from "@/lib/busqueda-inteligente/url";
import type { NodoArbol } from "@/lib/busqueda-inteligente/tipos";
import type { ResultadoBanco } from "./banco";
import { VISTA_ACTUAL, estadoBase, type VistaBanco } from "./vista";

export interface ContextoFase1 {
  arbol: NodoArbol[];
  jev: Dependencias["jev"];
  estructurados: boolean;
  /** Visibilidad y stock con que se mide. Por defecto `VISTA_ACTUAL` (la variante de siempre del banco). */
  vista?: VistaBanco;
}

async function pagina(estado: EstadoCatalogo, estructurados: boolean, vista: VistaBanco): Promise<PaginaCatalogo> {
  const q = estado.query?.trim() ?? "";
  const filtros: FiltrosCatalogo = { ...filtrosDeEstado(estado), texto: { q }, ...(estructurados ? { atributosEstructurados: true } : {}) };
  const exacta = await getPaginaCatalogo({ filtros, orden: estado.orden, pagina: 1, soloVisibles: vista.soloVisibles });
  if (exacta.total > 0 || !q) return exacta;
  const tolerante = await getPaginaCatalogo({
    filtros: { ...filtros, texto: { q, tolerante: true } },
    orden: estado.orden,
    pagina: 1,
    soloVisibles: vista.soloVisibles,
  });
  return tolerante.total > 0 ? tolerante : exacta;
}

export async function ejecutarFase1(q: string, ctx: ContextoFase1): Promise<ResultadoBanco> {
  const inicio = Date.now();
  const vista = ctx.vista ?? VISTA_ACTUAL;
  const estado = estadoBase(q, vista);
  const clasica = await pagina(estado, ctx.estructurados, vista);
  const vacio = { intencion: undefined, categoriasDuras: [], categoriasBlandas: [], atributosDuros: [], expansiones: [] };
  if (!debeInterpretar(q, clasica.total)) {
    return { ...vacio, productos: clasica.productos, total: clasica.total, ms: Date.now() - inicio };
  }
  const interpretacion = await interpretarCon(q, {
    arbol: ctx.arbol,
    jev: ctx.jev,
    leerCache: async () => null,
    guardarCache: async () => {},
  });
  const entendido = {
    intencion: undefined,
    categoriasDuras: interpretacion?.aplicar.categorias ?? [],
    categoriasBlandas: interpretacion?.sugerir.categorias ?? [],
    atributosDuros: interpretacion?.aplicar.atributos ?? [],
    expansiones: [],
  };
  if (clasica.total >= POCOS_RESULTADOS) {
    // Con resultados la franja sólo sugiere: nada se aplica, la grilla es la clásica.
    return {
      ...entendido,
      categoriasDuras: [],
      atributosDuros: [],
      categoriasBlandas: [...entendido.categoriasDuras, ...entendido.categoriasBlandas],
      productos: clasica.productos,
      total: clasica.total,
      ms: Date.now() - inicio,
    };
  }
  const decision = await decidirBusqueda(estado, clasica.total, interpretacion, async (destino) =>
    (await pagina(destino, ctx.estructurados, vista)).total,
  );
  if (!decision.redirigir || !interpretacion) {
    return {
      ...entendido,
      categoriasDuras: [],
      atributosDuros: [],
      categoriasBlandas: [...entendido.categoriasDuras, ...entendido.categoriasBlandas],
      productos: clasica.productos,
      total: clasica.total,
      ms: Date.now() - inicio,
    };
  }
  const final = await pagina(estadoInterpretado(estado, interpretacion), ctx.estructurados, vista);
  return { ...entendido, productos: final.productos, total: final.total, ms: Date.now() - inicio };
}
