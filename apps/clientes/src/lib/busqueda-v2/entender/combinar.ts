/**
 * Combinación de lo que entendieron el diccionario y Jev en un `PlanBusqueda`
 * (spec 2026-10-01, "Combinación"). Módulo puro: los conteos llegan como
 * dependencia. La regla de fondo: en una tienda el error caro es no mostrar lo
 * que existe, así que sólo filtra (duro) lo que tiene evidencia fuerte; el
 * resto suma candidatos y ordena (blando).
 *
 * - Categoría DURA sólo si Jev la elige con confianza ≥ 0,9 Y (el diccionario
 *   la tenía como candidata O la subcategoría también sale ≥ 0,9) Y el conteo
 *   con ese filtro (más los atributos duros) es > 0. Si no, blanda con
 *   peso = confianza.
 * - Atributo DURO sólo si el usuario lo pidió explícitamente y el conteo con
 *   él es ≥ 3. Tono y ambiente inferidos por Jev, siempre blandos.
 * - Intención `pregunta` (≥ 0,7): sin duros.
 * - Sin Jev: diccionario y sinónimos; nada duro salvo atributos explícitos.
 */
import { atributoPorId } from "../../catalogo-atributos";
import { pareceLenguajeNatural } from "../../busqueda-inteligente/gate";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import { PESO_MINIMO_RECUPERAR, type Intencion, type PlanBusqueda } from "../plan";
import type { CandidatosDiccionario } from "./diccionario";
import type { Termino } from "./terminos";

/** Confianza desde la que una categoría (o la subcategoría que la confirma) pasa a dura. */
export const UMBRAL_DURO = 0.9;
/** Confianza desde la que Jev decide la intención "pregunta" (y desde la que suma tono/ambiente). */
export const UMBRAL_PREGUNTA = 0.7;
export const UMBRAL_ATRIBUTO_JEV = 0.7;
/** Confianza mínima para tomar la intención de Jev (por debajo decide la heurística). */
export const UMBRAL_INTENCION = 0.5;
/** Conteo mínimo para que un atributo explícito filtre. */
export const MINIMO_ATRIBUTO_DURO = 3;

/** Pesos de lo blando que no trae confianza propia. */
export const PESO_ATRIBUTO_EXPLICITO = 0.9;
export const PESO_ATRIBUTO_CONTEXTO = 0.6;
export const PESO_CATEGORIA_DICCIONARIO = 0.8;
export const PESO_CATEGORIA_DICCIONARIO_CON_JEV = 0.5;
/** La raíz se suma blanda a mitad de su confianza (y sólo sin una subcategoría segura): es demasiado amplia. */
export const FACTOR_RAIZ = 0.5;
/** Subcategoría con menos confianza que esto no se suma. */
export const MINIMO_SUB_BLANDA = 0.3;
/** Tope de categorías blandas. */
const MAX_CATEGORIAS_BLANDAS = 4;

export interface Elegido {
  nombre: string;
  confianza: number;
}

/** Lo que aportó Jev, ya traducido a nombres e ids del Shop. `null` = sin Jev (no hay, falló o tope). */
export interface AporteJev {
  intencion?: { valor: Intencion; confianza: number };
  raiz?: Elegido;
  sub?: Elegido;
  /** Atributos inferidos (tono, ambiente) por id del diccionario. */
  atributos: { id: string; confianza: number }[];
}

/**
 * Cuántos productos dejan esos filtros. `terminos`: además, que tengan alguno de esos términos
 * (los que recuperan): una categoría dura tiene que dejar resultados PARA ESTA búsqueda, no sólo
 * existir ("térmica 20 amperes" no puede quedar en una categoría donde ningún producto es una
 * térmica).
 */
export type Contar = (filtros: { categorias: string[]; atributos: string[]; terminos?: string[] }) => Promise<number>;

/** Arranque de pregunta: interrogativos y "sirve", "conviene", "se puede". */
const PREGUNTA = /^(que|como|cuanto|cuantos|cuanta|cuantas|cual|cuales|donde|cuando|sirve|conviene|puedo|se puede|es mejor|hay)( |$)/;

/**
 * Intención sin Jev (o con Jev dudoso). Los códigos los corta antes `pareceCodigo`. Una frase que
 * EMPIEZA nombrando algo ("cable para toma cocina", "aplique para el baño") pide un producto; una
 * que empieza con contexto o un verbo ("luz para el patio…", "algo para sacar…") describe una
 * necesidad. `terminos`: los de `terminosDe`, en el orden de la consulta.
 */
export function intencionHeuristica(consulta: string, consultaNorm: string, terminos: readonly Termino[] = []): Intencion {
  if (consulta.includes("?") || PREGUNTA.test(consultaNorm)) return "pregunta";
  if (!pareceLenguajeNatural(consultaNorm)) return "producto";
  return (terminos[0]?.peso ?? 0) >= 1 ? "producto" : "necesidad";
}

function intencionFinal(consulta: string, norm: string, jev: AporteJev | null, terminos: readonly Termino[]): Intencion {
  const j = jev?.intencion;
  // "codigo" sólo por regex: si Jev ve un código que la regex no vio, es un producto con modelo.
  if (j && j.confianza >= UMBRAL_INTENCION) {
    if (j.valor === "codigo") return "producto";
    if (j.valor !== "pregunta" || j.confianza >= UMBRAL_PREGUNTA) return j.valor;
  }
  return intencionHeuristica(consulta, norm, terminos);
}

/** ¿`ancestro` contiene a `nombre` (o es ella)? Por nombre, en el árbol activo. */
function contiene(arbol: NodoArbol[], ancestro: string, nombre: string): boolean {
  const porId = new Map(arbol.map((n) => [n.id, n]));
  for (const n of arbol.filter((x) => x.nombre === nombre)) {
    const vistos = new Set<string>();
    for (let m: NodoArbol | undefined = n; m && !vistos.has(m.id); m = m.parentId ? porId.get(m.parentId) : undefined) {
      vistos.add(m.id);
      if (m.nombre === ancestro) return true;
    }
  }
  return false;
}

export interface EntradaCombinar {
  consulta: string;
  consultaNorm: string;
  arbol: NodoArbol[];
  diccionario: CandidatosDiccionario;
  terminos: Termino[];
  jev: AporteJev | null;
  /** Conteo de cada atributo explícito por separado (en paralelo con Jev). */
  conteoAtributos: Record<string, number>;
  contar: Contar;
}

export async function combinar(e: EntradaCombinar): Promise<PlanBusqueda> {
  const { arbol, diccionario: dic, jev } = e;
  const intencion = intencionFinal(e.consulta, e.consultaNorm, jev, e.terminos);
  const pregunta = intencion === "pregunta";

  // Atributos.
  const atributosDuros = pregunta
    ? []
    : dic.atributosExplicitos.filter((id) => (e.conteoAtributos[id] ?? 0) >= MINIMO_ATRIBUTO_DURO);
  const atributosBlandos = new Map<string, number>();
  const sumarAtributo = (id: string, peso: number) => {
    if (!atributosDuros.includes(id)) atributosBlandos.set(id, Math.max(peso, atributosBlandos.get(id) ?? 0));
  };
  for (const id of dic.atributosExplicitos) sumarAtributo(id, PESO_ATRIBUTO_EXPLICITO);
  const gruposExplicitos = new Set(dic.atributosExplicitos.map((id) => atributoPorId(id)?.grupo));
  for (const a of jev?.atributos ?? []) {
    // Lo que el usuario escribió manda: "cálida" escrito y Jev dice "fría" ⇒ se ignora a Jev.
    if (a.confianza >= UMBRAL_ATRIBUTO_JEV && !gruposExplicitos.has(atributoPorId(a.id)?.grupo)) sumarAtributo(a.id, a.confianza);
  }
  for (const id of dic.atributosContexto) {
    if (!gruposExplicitos.has(atributoPorId(id)?.grupo)) sumarAtributo(id, PESO_ATRIBUTO_CONTEXTO);
  }

  // Categoría dura: Jev seguro y una segunda evidencia (diccionario o subcategoría segura), con resultados.
  let dura: string | undefined;
  const raiz = jev?.raiz;
  const sub = jev?.sub;
  if (!pregunta && raiz && raiz.confianza >= UMBRAL_DURO) {
    const candidata =
      sub && sub.confianza >= UMBRAL_DURO
        ? sub.nombre
        : sub && dic.categorias.includes(sub.nombre)
          ? sub.nombre
          : dic.categorias.includes(raiz.nombre)
            ? raiz.nombre
            : undefined;
    const terminos = e.terminos.filter((t) => t.peso >= PESO_MINIMO_RECUPERAR).map((t) => t.texto);
    if (candidata && (await e.contar({ categorias: [candidata], atributos: atributosDuros, terminos })) > 0) dura = candidata;
  }

  // Categorías blandas, de más a menos confianza.
  const blandas = new Map<string, number>();
  const sumarCategoria = (nombre: string, peso: number) => {
    if (dura && contiene(arbol, dura, nombre)) return; // ya está dentro del filtro duro
    blandas.set(nombre, Math.max(peso, blandas.get(nombre) ?? 0));
  };
  if (sub && sub.confianza >= MINIMO_SUB_BLANDA) sumarCategoria(sub.nombre, sub.confianza);
  if (raiz && (!sub || sub.confianza < UMBRAL_PREGUNTA)) sumarCategoria(raiz.nombre, raiz.confianza * FACTOR_RAIZ);
  for (const c of dic.categorias) {
    if (!jev) sumarCategoria(c, PESO_CATEGORIA_DICCIONARIO);
    // Con Jev, el diccionario sólo suma lo que cae dentro de la raíz que eligió Jev.
    else if (raiz && contiene(arbol, raiz.nombre, c)) sumarCategoria(c, PESO_CATEGORIA_DICCIONARIO_CON_JEV);
  }
  const redondear = (n: number) => Math.round(n * 100) / 100;

  return {
    version: 1,
    consulta: e.consulta,
    intencion,
    duros: { categorias: dura ? [dura] : [], atributos: atributosDuros },
    blandos: {
      categorias: [...blandas]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CATEGORIAS_BLANDAS)
        .map(([nombre, peso]) => ({ nombre, peso: redondear(peso) })),
      atributos: [...atributosBlandos].map(([id, peso]) => ({ id, peso: redondear(peso) })),
      terminos: e.terminos.map((t) => ({ texto: t.texto, peso: redondear(t.peso) })),
    },
    fuente: jev ? "jev" : "deterministico",
  };
}
