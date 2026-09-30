/**
 * Atributos del catálogo como filtro real (`?atr=`): tono de luz, apto
 * exterior, zócalo y tensión.
 *
 * En Central LED las especificaciones viven en el NOMBRE del producto
 * ("REFLECTOR LED 50W CALIDO", "TIRA 5050 BCO FRIO IP20"), no en campos. Hasta
 * que haya fichas técnicas estructuradas, cada atributo es un patrón sobre el
 * mismo texto normalizado que usa la búsqueda (`textoBuscableSql` en
 * catalog.ts: minúsculas y sin tildes). Cobertura parcial a propósito: una
 * etiqueta encuentra el producto sólo si el nombre o la descripción lo dicen.
 * El día que haya un campo estructurado cambia el patrón, no la URL ni la UI.
 *
 * Fase 2 (fichas estructuradas): cada atributo declara además su `estructurado`, el criterio
 * sobre `public.catalog_atributos` del CRM. Si el producto TIENE un valor para esa clave, decide
 * el valor (una corrección manual en el CRM le gana al nombre); si no lo tiene, decide el patrón.
 * Misma URL (`?atr=`), misma UI: sólo sube la cobertura. Sin la tabla (migración sin aplicar) todo
 * queda como en la fase 1.
 *
 * Módulo puro (sin DB ni React): lo usan el SQL del catálogo (`~*`), la URL
 * (valida los ids), el panel de filtros, la interpretación de búsquedas y el
 * chat (`attributes` de `resolveProducts`).
 *
 * Los patrones se escriben en el subconjunto común de las regex de Postgres
 * (ARE) y de JavaScript: alternativas, clases `[...]`, grupos, `^` y `$`. Nada
 * de `\b`, `\m`, `[[:alnum:]]` ni lookarounds: el test los corre en JS y la
 * base los corre en Postgres, y tienen que significar lo mismo. El borde de
 * palabra se escribe `(^|[^a-z0-9])` sobre el texto ya normalizado.
 */

import type { AtributosEstructurados, ClaveEstructurada, ValorEstructurado } from "./catalogo-caracteristicas";

export const GRUPOS_ATRIBUTO = ["tono", "ambiente", "zocalo", "tension"] as const;
export type GrupoAtributo = (typeof GRUPOS_ATRIBUTO)[number];

export interface Atributo {
  /** Slug, lo que viaja en la URL: "tono-calido". */
  id: string;
  grupo: GrupoAtributo;
  /** Lo que ve el usuario: "Luz cálida". */
  nombre: string;
  /** Regex para Postgres `~*` (y JS) sobre nombre + descripción normalizados. */
  patron: string;
  /**
   * Formas normalizadas (minúsculas, sin tildes) que, escritas en una
   * búsqueda como palabra o frase completa, disparan el atributo de forma
   * determinista (ver busqueda-inteligente/deterministico.ts).
   */
  sinonimos: string[];
  /** Criterio sobre el dato estructurado (ver `cumpleEstructurado`). */
  estructurado?: CriterioEstructurado;
}

/**
 * Qué valor de `catalog_atributos` cumple un atributo. Alcanza con que cumpla UNO de los
 * criterios dados:
 * - `textos`: `valor_texto` es uno de estos (tono "calido", zócalo "e27");
 * - `numeros`: `valor_num` es uno de estos (tensión 220 o 230);
 * - `desde`/`hasta`: `valor_num` en el rango (IP 65 a 68);
 * - `enRango`: `valor_texto` es un rango "a-b" que incluye este número (tensión "85-265" ⇒ 220).
 */
export interface CriterioEstructurado {
  clave: ClaveEstructurada;
  textos?: string[];
  numeros?: number[];
  desde?: number;
  hasta?: number;
  enRango?: number;
}

/** Inicio de palabra sobre texto normalizado. */
const INI = "(^|[^a-z0-9])";
/** Fin de palabra sobre texto normalizado. */
const FIN = "([^a-z0-9]|$)";
/** Temperatura de color en kelvin: "3000k", "3000 k", "3000°k". */
const kelvin = (valores: string) => `(^|[^0-9])(${valores}) ?°?k${FIN}`;
/** Zócalo: "e27", "e-27", "e 27". */
const zocalo = (letras: string, numero: string) => `${INI}${letras}[- ]?${numero}([^0-9]|$)`;
/** Tensión: "12v", "12 v", "12vcc", "12 volts". No confunde con "12w" ni con "112v". */
const tension = (valor: string) => `(^|[^0-9.,])${valor} ?(v|vcc|vdc|vac|volt)`;

/**
 * Diccionario v1 (en código, no editable en el admin). El orden es el del
 * panel de filtros: tono → ambiente → zócalo → tensión.
 */
export const ATRIBUTOS: readonly Atributo[] = [
  {
    id: "tono-calido",
    grupo: "tono",
    nombre: "Luz cálida",
    // "calid[oa]" y no "calid": "ALTA CALIDAD" no es luz cálida.
    patron: `${INI}calid[oa]s?${FIN}|${INI}warm${FIN}|${kelvin("2700|3000")}`,
    sinonimos: ["calida", "calido", "calidas", "calidos", "warm", "2700k", "3000k", "luz calida"],
    estructurado: { clave: "tono", textos: ["calido"] },
  },
  {
    id: "tono-neutro",
    grupo: "tono",
    nombre: "Luz neutra",
    patron: `${INI}neutr[oa]s?${FIN}|${kelvin("4000|4500")}`,
    sinonimos: ["neutra", "neutro", "neutras", "neutros", "4000k", "4500k", "luz neutra"],
    estructurado: { clave: "tono", textos: ["neutro"] },
  },
  {
    id: "tono-frio",
    grupo: "tono",
    nombre: "Luz fría",
    patron: `${INI}fri[oa]s?${FIN}|${INI}luz (de )?dia${FIN}|${INI}daylight${FIN}|${kelvin("6000|6500")}`,
    sinonimos: ["fria", "frio", "frias", "frios", "6000k", "6500k", "luz dia", "luz de dia", "luz fria"],
    estructurado: { clave: "tono", textos: ["frio"] },
  },
  {
    id: "apto-exterior",
    grupo: "ambiente",
    nombre: "Apto exterior",
    // IP65 a IP68: protegidos contra chorros de agua. IP20/IP44 no.
    patron: `${INI}ip ?6[5-8]([^0-9]|$)|${INI}exterior(es)?${FIN}|${INI}intemperie${FIN}`,
    sinonimos: ["exterior", "exteriores", "intemperie", "ip65", "ip66", "ip67", "ip68"],
    estructurado: { clave: "ip", desde: 65, hasta: 68 },
  },
  {
    id: "zocalo-e27",
    grupo: "zocalo",
    nombre: "Rosca E27",
    patron: zocalo("e", "27"),
    sinonimos: ["e27", "e 27", "rosca comun", "rosca grande"],
    estructurado: { clave: "zocalo", textos: ["e27"] },
  },
  {
    id: "zocalo-e14",
    grupo: "zocalo",
    nombre: "Rosca E14",
    patron: zocalo("e", "14"),
    sinonimos: ["e14", "e 14", "rosca fina", "rosca chica"],
    estructurado: { clave: "zocalo", textos: ["e14"] },
  },
  {
    id: "zocalo-gu10",
    grupo: "zocalo",
    nombre: "GU10",
    patron: zocalo("gu", "10"),
    sinonimos: ["gu10", "gu 10"],
    estructurado: { clave: "zocalo", textos: ["gu10"] },
  },
  {
    id: "zocalo-mr16",
    grupo: "zocalo",
    nombre: "MR16",
    patron: zocalo("mr", "16"),
    sinonimos: ["mr16", "mr 16"],
    estructurado: { clave: "zocalo", textos: ["mr16"] },
  },
  {
    id: "tension-12v",
    grupo: "tension",
    nombre: "12 V",
    patron: tension("12"),
    sinonimos: ["12v", "12 v", "12vcc", "12 volts", "12 volt"],
    estructurado: { clave: "tension_v", numeros: [12], enRango: 12 },
  },
  {
    id: "tension-24v",
    grupo: "tension",
    nombre: "24 V",
    patron: tension("24"),
    sinonimos: ["24v", "24 v", "24vcc", "24 volts", "24 volt"],
    estructurado: { clave: "tension_v", numeros: [24], enRango: 24 },
  },
  {
    id: "tension-220v",
    grupo: "tension",
    nombre: "220 V",
    // 220/230 V explícitos, o un rango de entrada que los incluye ("AC85-265V").
    patron: `${tension("2[23]0")}|[0-9]{2,3} ?- ?2[4-6][05] ?(v|vac|volt)`,
    sinonimos: ["220v", "220 v", "220vac", "220 volts", "230v"],
    estructurado: { clave: "tension_v", numeros: [220, 230], enRango: 220 },
  },
];

const POR_ID = new Map(ATRIBUTOS.map((a) => [a.id, a]));

/** Atributo por id, o `undefined` si no está en el diccionario. */
export function atributoPorId(id: string): Atributo | undefined {
  return POR_ID.get(id);
}

/** ¿Es un id del diccionario? (la URL descarta los que no). */
export function esAtributo(id: string): boolean {
  return POR_ID.has(id);
}

/** Nombre visible de un atributo; el id tal cual si no existe. */
export function nombreAtributo(id: string): string {
  return POR_ID.get(id)?.nombre ?? id;
}

/**
 * Ids válidos, sin repetidos, en el orden del diccionario (así dos URLs con
 * los mismos atributos tildados en otro orden dan la misma URL).
 */
export function atributosValidos(ids: readonly string[]): string[] {
  const pedidos = new Set(ids);
  return ATRIBUTOS.filter((a) => pedidos.has(a.id)).map((a) => a.id);
}

/**
 * Ids agrupados por grupo, para el SQL: AND entre grupos, OR dentro del grupo.
 * Sólo grupos con algún id válido.
 */
export function atributosPorGrupo(ids: readonly string[]): Map<GrupoAtributo, Atributo[]> {
  const grupos = new Map<GrupoAtributo, Atributo[]>();
  for (const id of atributosValidos(ids)) {
    const a = POR_ID.get(id)!;
    grupos.set(a.grupo, [...(grupos.get(a.grupo) ?? []), a]);
  }
  return grupos;
}

/** Minúsculas y sin tildes: el mismo texto que ve `~*` en la base. */
export function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const REGEX = new Map(ATRIBUTOS.map((a) => [a.id, new RegExp(a.patron, "i")]));

/**
 * Atributos del diccionario que cumple un texto (nombre + descripción de un
 * producto), en el orden del diccionario. Mismo criterio que el filtro SQL.
 */
export function atributosDeTexto(texto: string): Atributo[] {
  const t = normalizarTexto(texto);
  return ATRIBUTOS.filter((a) => REGEX.get(a.id)!.test(t));
}

/**
 * ¿El valor estructurado cumple el criterio? `null` si el producto no tiene dato para esa clave
 * (entonces decide el patrón sobre el nombre). Mismo criterio que el SQL de catalogo-atributos-sql.
 */
export function cumpleEstructurado(c: CriterioEstructurado, v: ValorEstructurado | undefined): boolean | null {
  if (!v) return null;
  if (c.textos && v.t != null && c.textos.includes(v.t)) return true;
  if (c.numeros && v.n != null && c.numeros.includes(v.n)) return true;
  if ((c.desde != null || c.hasta != null) && v.n != null && v.n >= (c.desde ?? -Infinity) && v.n <= (c.hasta ?? Infinity)) {
    return true;
  }
  if (c.enRango != null && v.t != null) {
    const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(v.t);
    if (m && Number(m[1]) <= c.enRango && c.enRango <= Number(m[2])) return true;
  }
  return false;
}

/**
 * Atributos del diccionario que cumple un producto: primero el dato estructurado de su clave (si
 * lo tiene) y, si no, el patrón sobre nombre + descripción. Sin `estructurados`, idéntico a
 * `atributosDeTexto`.
 */
export function atributosDeProducto(texto: string, estructurados?: AtributosEstructurados): Atributo[] {
  if (!estructurados) return atributosDeTexto(texto);
  const t = normalizarTexto(texto);
  return ATRIBUTOS.filter((a) => {
    const decide = a.estructurado ? cumpleEstructurado(a.estructurado, estructurados[a.estructurado.clave]) : null;
    return decide ?? REGEX.get(a.id)!.test(t);
  });
}
