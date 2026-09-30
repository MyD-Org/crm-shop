/**
 * Interpretación de una búsqueda del catálogo en filtros reales, con escalera
 * de costo: caché → determinista → Jev (spec catálogo asistido, platform
 * 2026-09-29).
 *
 * Nunca rompe la búsqueda: sin caché, sin `JEV_API_KEY` o con Jev caído queda
 * lo que se pudo (como mínimo, lo determinista).
 *
 * El núcleo (`interpretarCon`) recibe sus dependencias para poder probarlo sin
 * base ni red; `interpretar` lo arma con las de verdad (SOLO servidor).
 */
import { atributoPorId } from "../catalogo-atributos";
import { pareceCodigo } from "./gate";
import { normalizarConsulta } from "./normalizar";
import { deterministico, textoResidual } from "./deterministico";
import {
  ATRIBUTO_DE_AMBIENTE,
  ATRIBUTO_DE_TONO,
  PREGUNTA_AMBIENTE,
  PREGUNTA_TONO,
  UMBRAL_SUGERIR,
  hijasDe,
  nivelDe,
  opcionesDeCategorias,
  type PreguntaChoice,
  type Respuestas,
} from "./jev";
import { hashArbol, type Guardado, type ResultadoGuardado } from "./cache";
import type { FiltrosInterpretados, Interpretacion, NodoArbol } from "./tipos";

export interface Dependencias {
  arbol: NodoArbol[];
  /**
   * Cliente de Jev. `null` = no configurado (sin `JEV_API_KEY`): se interpreta
   * sólo con lo determinista y el resultado se guarda igual. Si está y
   * devuelve `null` (caído, lento), el resultado NO se guarda: la próxima vez
   * se vuelve a intentar con Jev.
   */
  jev:
    | ((consulta: string, preguntas: Record<string, PreguntaChoice>, timeoutMs: number) => Promise<Respuestas | null>)
    | null;
  /** Reloj (ms) para el presupuesto de Jev; por defecto `Date.now`. */
  ahora?: () => number;
  leerCache: (consultaNorm: string, arbolHash: string) => Promise<Guardado | null>;
  guardarCache: (consultaNorm: string, arbolHash: string, guardado: Guardado) => Promise<void>;
}

const vacio = (): FiltrosInterpretados => ({ categorias: [], atributos: [] });

/**
 * Presupuesto TOTAL de Jev por interpretación (las dos llamadas juntas): el
 * camino que redirige con 0–3 resultados nunca espera más que esto.
 */
export const PRESUPUESTO_JEV_MS = 2500;
/** Con menos de esto por delante, la subcategoría no se pregunta (no llegaría). */
export const MINIMO_PARA_SUB_MS = 400;

const PREGUNTA_RAIZ = "¿A qué categoría de la tienda corresponde lo que busca el cliente?";
const PREGUNTA_SUB = "¿A qué subcategoría corresponde lo que busca el cliente?";

/** Lo que aporta Jev, ya pasado por el semáforo. */
interface AporteJev {
  aplicar: FiltrosInterpretados;
  sugerir: FiltrosInterpretados;
}

/** Suma un elemento al balde que le toca según la confianza. */
function clasificar(aporte: AporteJev, tipo: keyof FiltrosInterpretados, valor: string, confianza: number) {
  const nivel = nivelDe(confianza);
  if (nivel) aporte[nivel][tipo].push(valor);
}

/**
 * Llamada 1: raíz (si el tenant tiene árbol), tono y ambiente. Llamada 2, sólo
 * si la raíz salió con confianza ≥ 0,7 y tiene más de una subcategoría: la
 * subcategoría. Con la sub aplicada, la raíz ya no hace falta (la incluye).
 */
async function preguntarAJev(
  consulta: string,
  arbol: NodoArbol[],
  jev: NonNullable<Dependencias["jev"]>,
  conCategoria: boolean,
  ahora: () => number,
): Promise<AporteJev | null> {
  const limite = ahora() + PRESUPUESTO_JEV_MS;
  const raices = hijasDe(arbol, null);
  const opcionesRaiz = conCategoria && raices.length > 1 ? opcionesDeCategorias(raices, arbol) : null;
  const preguntas: Record<string, PreguntaChoice> = { tono: PREGUNTA_TONO, ambiente: PREGUNTA_AMBIENTE };
  if (opcionesRaiz) preguntas.raiz = { type: "choice", question: PREGUNTA_RAIZ, criteria: opcionesRaiz.criteria };

  const r1 = await jev(consulta, preguntas, PRESUPUESTO_JEV_MS);
  if (!r1) return null;
  const aporte: AporteJev = { aplicar: vacio(), sugerir: vacio() };

  const tono = r1.tono && ATRIBUTO_DE_TONO[r1.tono.choice];
  if (tono) clasificar(aporte, "atributos", tono, r1.tono.confidence);
  const ambiente = r1.ambiente && ATRIBUTO_DE_AMBIENTE[r1.ambiente.choice];
  if (ambiente) clasificar(aporte, "atributos", ambiente, r1.ambiente.confidence);

  const raiz = r1.raiz && opcionesRaiz?.porClave.get(r1.raiz.choice);
  if (!raiz || !r1.raiz) return aporte;

  const hijas = hijasDe(arbol, raiz.id);
  let sub: { nodo: NodoArbol; confianza: number } | null = null;
  const restante = limite - ahora();
  if (r1.raiz.confidence >= UMBRAL_SUGERIR && hijas.length > 1 && restante >= MINIMO_PARA_SUB_MS) {
    const opcionesSub = opcionesDeCategorias(hijas, arbol);
    const r2 = await jev(
      consulta,
      { sub: { type: "choice", question: PREGUNTA_SUB, criteria: opcionesSub.criteria } },
      restante,
    );
    const nodo = r2?.sub && opcionesSub.porClave.get(r2.sub.choice);
    if (nodo && r2?.sub) sub = { nodo, confianza: r2.sub.confidence };
  }

  const nivelRaiz = nivelDe(r1.raiz.confidence);
  const nivelSub = sub ? nivelDe(sub.confianza) : null;
  if (sub && nivelSub === "aplicar" && nivelRaiz === "aplicar") {
    aporte.aplicar.categorias.push(sub.nodo.nombre);
  } else {
    if (nivelRaiz) aporte[nivelRaiz].categorias.push(raiz.nombre);
    // Una sub segura bajo una raíz dudosa, o una sub dudosa: se sugiere.
    if (sub && nivelSub) aporte.sugerir.categorias.push(sub.nodo.nombre);
  }
  return aporte;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const sinLosDe = (a: string[], quitar: string[]) => a.filter((x) => !quitar.includes(x));

/**
 * Junta lo determinista con lo de Jev. Lo determinista manda: un atributo de
 * Jev de un grupo que lo determinista ya resolvió ("calida" escrito, Jev dice
 * "frio") se descarta. Lo que se aplica no se sugiere.
 */
function combinar(det: FiltrosInterpretados, jev: AporteJev | null): ResultadoGuardado {
  const gruposDet = new Set(det.atributos.map((id) => atributoPorId(id)?.grupo));
  const deJev = (ids: string[]) => ids.filter((id) => !gruposDet.has(atributoPorId(id)?.grupo));
  const aplicar = {
    categorias: union(det.categorias, jev?.aplicar.categorias ?? []),
    atributos: union(det.atributos, deJev(jev?.aplicar.atributos ?? [])),
  };
  return {
    aplicar,
    sugerir: {
      categorias: sinLosDe(jev?.sugerir.categorias ?? [], aplicar.categorias),
      atributos: sinLosDe(deJev(jev?.sugerir.atributos ?? []), aplicar.atributos),
    },
  };
}

/**
 * Interpreta `q`. `null` si no corresponde: parece un código, queda vacía o
 * parece un dato personal (no se interpreta ni se guarda).
 */
export async function interpretarCon(q: string, deps: Dependencias): Promise<Interpretacion | null> {
  const consulta = q.trim();
  if (!consulta || pareceCodigo(consulta)) return null;
  const norm = normalizarConsulta(consulta);
  if (!norm) return null;

  const arbolHash = hashArbol(deps.arbol);
  const enCache = await deps.leerCache(norm, arbolHash);
  if (enCache) return { consulta, ...enCache.resultado, fuente: "cache" };

  const det = deterministico(norm, deps.arbol);
  // Escalera de costo: con una categoría resuelta por nombre, Jev no suma.
  const usarJev = det.categorias.length === 0 && deps.jev != null;
  const jev = usarJev ? await preguntarAJev(consulta, deps.arbol, deps.jev!, true, deps.ahora ?? Date.now) : null;
  const resultado = combinar(det, jev);

  const aplica = resultado.aplicar.categorias.length > 0 || resultado.aplicar.atributos.length > 0;
  const q2 = aplica ? textoResidual(norm, det.absorbidos) : undefined;
  if (q2) resultado.aplicar.q = q2;

  const aportoJev =
    !!jev &&
    jev.aplicar.categorias.length + jev.aplicar.atributos.length + jev.sugerir.categorias.length + jev.sugerir.atributos.length > 0;
  const fuente = aportoJev ? "jev" : "deterministico";
  // Jev se necesitaba y falló: no se guarda (sería guardar lo determinista
  // como si fuera la respuesta completa).
  if (!usarJev || jev) await deps.guardarCache(norm, arbolHash, { resultado, fuente });
  return { consulta, ...resultado, fuente };
}
