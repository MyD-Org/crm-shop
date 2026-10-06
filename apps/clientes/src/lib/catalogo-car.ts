/**
 * Gramática de `?car=` (change `catalogo-filtros-ux`): una característica por parámetro repetible.
 *
 *   car=<clave>:<valor>        valor exacto (claves de control lista: polos:2, curva:c, tono:calido)
 *   car=<clave>:<min>-<max>    rango (claves de control rango, salvo la potencia: flujo_lm:800-1200)
 *
 * Es el filtro ESTRICTO de las facetas por tipo y no tiene nada que ver con `?atr=` (que filtra "por no
 * contradicción"): no comparten gramática ni semántica. Dentro de una clave es OR; entre claves, AND.
 * Solo valen las claves y formas del registro (`catalogo-facetas-registro.ts`); lo inválido se descarta al
 * leer. La potencia no entra: sigue en `potencia_min`/`potencia_max`.
 *
 * Módulo puro, sin IO.
 */
import { RANGOS, numeroCanonico, type ClaveMedida } from "./catalogo-atributos-medida";
import { claveFacetable, etiquetaValor, valorDeListaValido, REGISTRO } from "./catalogo-facetas-registro";

/** Ids `car` que se leen de una URL como máximo. */
export const MAX_CAR = 8;
/** Largo máximo de un id completo. */
export const MAX_LARGO_CAR = 40;

export type CarLeido = { clave: string; op: "valor"; valor: string } | { clave: string; op: "rango"; min: number; max: number };

export interface EntradaCar {
  clave: string;
  valor?: string | number;
  min?: number;
  max?: number;
}

/** Cada extremo de un rango tiene que ser un número canónico dentro del rango válido de la clave. */
function extremo(clave: string, texto: string): number | null {
  const n = numeroCanonico(texto);
  if (n === null) return null;
  const valido = RANGOS[clave as ClaveMedida];
  return valido && (n < valido[0] || n > valido[1]) ? null : n;
}

/** Lee un id `car`. `null` si no cumple la gramática cerrada (clave, forma, canonicidad, rango, largo). */
export function leerIdCar(id: string): CarLeido | null {
  if (typeof id !== "string" || id.length > MAX_LARGO_CAR) return null;
  const corte = id.indexOf(":");
  if (corte < 1) return null;
  const clave = id.slice(0, corte);
  const resto = id.slice(corte + 1);
  const def = claveFacetable(clave);
  // La potencia es un rango con parámetros propios: no viaja por `car`.
  if (!def || def.param) return null;

  if (def.control === "lista") return valorDeListaValido(clave, resto) ? { clave, op: "valor", valor: resto } : null;

  const trozos = resto.split("-");
  if (trozos.length !== 2) return null;
  const min = extremo(clave, trozos[0]);
  const max = extremo(clave, trozos[1]);
  return min !== null && max !== null && min < max ? { clave, op: "rango", min, max } : null;
}

/** Id canónico a partir de sus partes. `null` si lo armado no pasa la gramática: lo que sale vuelve igual por `leerIdCar`. */
export function idCar(c: EntradaCar): string | null {
  if (!c || typeof c.clave !== "string") return null;
  let id: string;
  if (typeof c.min === "number" && typeof c.max === "number") id = `${c.clave}:${c.min}-${c.max}`;
  else if (typeof c.valor === "string" || typeof c.valor === "number") id = `${c.clave}:${c.valor}`;
  else return null;
  return leerIdCar(id) ? id : null;
}

/** Clave de un id `car` (lo que hay antes de los dos puntos). */
export function claveDeCar(id: string): string {
  return id.slice(0, Math.max(0, id.indexOf(":")));
}

const POSICION = new Map<string, number>(REGISTRO.map((c) => [c.clave, c.orden]));

function comparar(a: CarLeido, b: CarLeido): number {
  const porClave = (POSICION.get(a.clave) ?? 0) - (POSICION.get(b.clave) ?? 0);
  if (porClave !== 0) return porClave;
  if (a.op === "rango" && b.op === "rango") return a.min - b.min || a.max - b.max;
  if (a.op === "valor" && b.op === "valor") {
    const numerica = !Number.isNaN(Number(a.valor)) && !Number.isNaN(Number(b.valor));
    return numerica ? Number(a.valor) - Number(b.valor) : a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0;
  }
  return 0;
}

/**
 * Los ids `car` válidos de una lista (lo que llega de la URL), sin repetidos, hasta `MAX_CAR` y en el
 * orden de emisión fijo: el del registro por clave y, dentro de cada una, el valor de menor a mayor. Así
 * la URL canónica no depende del orden en que se tildó.
 */
export function leerCar(ids: readonly string[]): string[] {
  const vistos = new Set<string>();
  const validos: { id: string; leido: CarLeido }[] = [];
  for (const id of ids) {
    if (validos.length >= MAX_CAR) break;
    const leido = leerIdCar(id);
    if (!leido || vistos.has(id)) continue;
    vistos.add(id);
    validos.push({ id, leido });
  }
  return validos.sort((a, b) => comparar(a.leido, b.leido)).map((v) => v.id);
}

/**
 * Lo que la page del catálogo suma a los filtros según el flag `catalogo-facetas-por-tipo` (y la tabla
 * legible): apagado, nada (`?car=` se ignora); prendido, el flag y los `car` válidos de la URL.
 */
export function filtrosPorTipo(
  habilitada: boolean,
  car: string | string[] | undefined,
): { facetasPorTipo?: true; caracteristicas?: string[] } {
  if (!habilitada) return {};
  const crudos = car == null ? [] : Array.isArray(car) ? car : [car];
  return { facetasPorTipo: true, caracteristicas: leerCar(crudos.map((c) => c.trim()).filter(Boolean)) };
}

const formatoNumero = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: false });

/** Texto del chip: "Polos: 2", "Curva: C", "Corriente: 20 A", "Flujo luminoso: 800 – 1200 lm". El id inválido se devuelve tal cual. */
export function etiquetaCar(id: string): string {
  const c = leerIdCar(id);
  if (!c) return id;
  const def = claveFacetable(c.clave)!;
  if (c.op === "valor") return `${def.titulo}: ${etiquetaValor(c.clave, c.valor)}`;
  const unidad = def.unidad ? (def.unidad === "°" ? "°" : ` ${def.unidad}`) : "";
  return `${def.titulo}: ${formatoNumero(c.min)} – ${formatoNumero(c.max)}${unidad}`;
}

/** Valores tildados de una clave de lista (`["polos:2", "polos:4"]` → `["2", "4"]`). */
export function carDeClave(car: readonly string[], clave: string): string[] {
  return car.flatMap((id) => {
    const c = leerIdCar(id);
    return c && c.clave === clave && c.op === "valor" ? [c.valor] : [];
  });
}

/** Nueva lista de `car` al tildar o destildar un valor de una clave de lista. Un valor inválido no se agrega. */
export function alternarCar(car: readonly string[], clave: string, valor: string, tildado: boolean): string[] {
  const id = `${clave}:${valor}`;
  if (!tildado) return car.filter((x) => x !== id);
  return leerIdCar(id) ? leerCar([...car.filter((x) => x !== id), id]) : [...car];
}

/** Rango tildado de una clave de control rango (`flujo_lm:800-1200` → `[800, 1200]`), o `undefined`. */
export function rangoDeCar(car: readonly string[], clave: string): [number, number] | undefined {
  for (const id of car) {
    const c = leerIdCar(id);
    if (c && c.clave === clave && c.op === "rango") return [c.min, c.max];
  }
  return undefined;
}

/**
 * Nueva lista de `car` al comprometer un rango en el slider de una clave. El rango que coincide con los
 * límites reales del conjunto (o degenerado) es "sin filtro": se quita el car de esa clave. Los extremos
 * se acotan al rango válido de la clave (el slider trabaja con enteros hacia afuera: un largo mínimo de
 * 0,5 m se ofrece como 0). Reemplaza al rango anterior de la misma clave.
 */
export function cambiosDeCarRango(
  car: readonly string[],
  clave: string,
  valor: readonly [number, number],
  limites: { min: number; max: number },
): string[] {
  const resto = car.filter((id) => claveDeCar(id) !== clave);
  const valido = RANGOS[clave as ClaveMedida];
  // A lo sumo dos decimales: lo que admite la gramática (y lo que saca de cuenta el ruido del slider).
  const acotar = (n: number) => {
    const redondo = Math.round(n * 100) / 100;
    return valido ? Math.min(Math.max(redondo, valido[0]), valido[1]) : redondo;
  };
  const [min, max] = [acotar(valor[0]), acotar(valor[1])];
  if (min >= max || (valor[0] <= limites.min && valor[1] >= limites.max)) return resto;
  const id = idCar({ clave, min, max });
  return id ? leerCar([...resto, id]) : resto;
}
