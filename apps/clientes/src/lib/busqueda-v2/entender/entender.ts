/**
 * ENTENDER (spec búsqueda v2, 2026-10-01): de lo que escribió el usuario a un
 * `PlanBusqueda`. Núcleo con dependencias inyectadas (árbol, Jev, conteo):
 * se prueba sin base ni red y lo usan el route handler `/buscar`, la página
 * del catálogo (recálculo determinista, SIN Jev) y el banco de búsquedas.
 *
 * 1. Normalización (como la fase 1: email/teléfono no se interpretan).
 * 2. Código (regex) ⇒ plan vacío con intención `codigo`, sin Jev.
 * 3. Diccionario (candidatas) y términos con sinónimos.
 * 4. Jev, UNA llamada (intención, raíz, tono, ambiente) más la subcategoría
 *    si la raíz salió ≥ 0,7 y queda presupuesto; en paralelo, el conteo de
 *    cada atributo explícito. Presupuesto total de Jev: 2,5 s.
 * 5. Combinación (combinar.ts).
 */
import { pareceCodigo } from "../../busqueda-inteligente/gate";
import { normalizarConsulta } from "../../busqueda-inteligente/normalizar";
import { ATRIBUTO_DE_AMBIENTE, ATRIBUTO_DE_TONO, type PreguntaChoice, type Respuestas } from "../../busqueda-inteligente/jev";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import { planVacio, type PlanBusqueda } from "../plan";
import { combinar, type AporteJev, type Contar } from "./combinar";
import { candidatos } from "./diccionario";
import { INTENCION_DE_OPCION, UMBRAL_SUB, opcionesRaiz, preguntaSub, preguntasPrincipales } from "./preguntas";
import { terminosDe } from "./terminos";

/** Presupuesto TOTAL de Jev (las dos llamadas). */
export const PRESUPUESTO_JEV_MS = 2500;
/** Con menos de esto por delante, la subcategoría no se pregunta. */
export const MINIMO_PARA_SUB_MS = 400;
/** Largo máximo de la consulta que se guarda en el plan. */
const LARGO_CONSULTA = 120;

export type ClienteJev = (
  consulta: string,
  preguntas: Record<string, PreguntaChoice>,
  timeoutMs: number,
) => Promise<Respuestas | null>;

export interface DepsEntender {
  arbol: NodoArbol[];
  /** `null` = sin Jev (no configurado, recálculo de la página, banco determinista). */
  jev: ClienteJev | null;
  contar: Contar;
  ahora?: () => number;
}

export interface Entendido {
  plan: PlanBusqueda;
  /** Milisegundos de Jev (las dos llamadas); `null` si no se llamó. */
  msJev: number | null;
  /** Jev se necesitaba y no respondió (caído, lento o tope): el plan no se guarda. */
  jevFallo: boolean;
  consultaNorm: string | null;
}

/** Respuestas de Jev → nombres e ids del Shop. */
async function preguntarAJev(norm: string, arbol: NodoArbol[], jev: ClienteJev, ahora: () => number): Promise<AporteJev | null> {
  const limite = ahora() + PRESUPUESTO_JEV_MS;
  const r1 = await jev(norm, preguntasPrincipales(arbol), PRESUPUESTO_JEV_MS);
  if (!r1) return null;
  const aporte: AporteJev = { atributos: [] };
  if (r1.intencion) {
    const valor = INTENCION_DE_OPCION[r1.intencion.choice as keyof typeof INTENCION_DE_OPCION];
    if (valor) aporte.intencion = { valor, confianza: r1.intencion.confidence };
  }
  const tono = r1.tono && ATRIBUTO_DE_TONO[r1.tono.choice];
  if (tono) aporte.atributos.push({ id: tono, confianza: r1.tono.confidence });
  const ambiente = r1.ambiente && ATRIBUTO_DE_AMBIENTE[r1.ambiente.choice];
  if (ambiente) aporte.atributos.push({ id: ambiente, confianza: r1.ambiente.confidence });

  const raiz = r1.raiz && opcionesRaiz(arbol)?.porClave.get(r1.raiz.choice);
  if (!raiz || !r1.raiz) return aporte;
  aporte.raiz = { nombre: raiz.nombre, confianza: r1.raiz.confidence };
  const restante = limite - ahora();
  const sub = preguntaSub(arbol, raiz);
  if (sub && r1.raiz.confidence >= UMBRAL_SUB && restante >= MINIMO_PARA_SUB_MS) {
    const r2 = await jev(norm, sub.preguntas, restante);
    const nodo = r2?.sub && sub.opciones.porClave.get(r2.sub.choice);
    if (nodo && r2?.sub) aporte.sub = { nombre: nodo.nombre, confianza: r2.sub.confidence };
  }
  return aporte;
}

/**
 * Entiende `q`. `null` si queda vacía o parece un dato personal (no se
 * interpreta ni se guarda: la búsqueda sigue clásica).
 */
export async function entender(q: string, deps: DepsEntender): Promise<Entendido | null> {
  const consulta = q.trim().slice(0, LARGO_CONSULTA).trim();
  if (!consulta) return null;
  if (pareceCodigo(consulta)) return { plan: planVacio(consulta, "codigo"), msJev: null, jevFallo: false, consultaNorm: null };
  const norm = normalizarConsulta(consulta);
  if (!norm) return null;

  const ahora = deps.ahora ?? Date.now;
  const diccionario = candidatos(norm, deps.arbol);
  const terminos = terminosDe(norm, diccionario.absorbidos);
  let msJev: number | null = null;
  const conJev = async (cliente: ClienteJev) => {
    const inicio = ahora();
    try {
      return await preguntarAJev(norm, deps.arbol, cliente, ahora);
    } finally {
      msJev = ahora() - inicio;
    }
  };
  const [conteos, jev] = await Promise.all([
    Promise.all(
      diccionario.atributosExplicitos.map(async (id) => [id, await deps.contar({ categorias: [], atributos: [id] })] as const),
    ),
    // A Jev viaja la consulta normalizada y recortada, nunca el `q` crudo.
    deps.jev ? conJev(deps.jev) : Promise.resolve(null),
  ]);
  const plan = await combinar({
    consulta,
    consultaNorm: norm,
    arbol: deps.arbol,
    diccionario,
    terminos,
    jev,
    conteoAtributos: Object.fromEntries(conteos),
    contar: deps.contar,
  });
  return { plan, msJev, jevFallo: !!deps.jev && !jev, consultaNorm: norm };
}
