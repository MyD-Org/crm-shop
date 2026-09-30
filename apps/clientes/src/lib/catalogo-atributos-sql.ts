/**
 * SQL del filtro y de las facetas de atributos (`?atr=`, ver
 * catalogo-atributos.ts). Vive aparte de catalog.ts para que ése no siga
 * creciendo; recibe el texto buscable ya normalizado (`textoBuscableSql()` de
 * catalog.ts: `immutable_unaccent(lower(...))`) como expresión.
 *
 * El patrón viaja como PARÁMETRO (`$n`), nunca interpolado: sale del
 * diccionario en código, pero así ni siquiera hace falta escaparlo.
 *
 * SOLO servidor (lo importa catalog.ts).
 */
import { and, or, sql, type SQL } from "drizzle-orm";
import { ATRIBUTOS, atributosPorGrupo, type Atributo } from "./catalogo-atributos";

/** El texto cumple el patrón de un atributo (`~*`, sin distinguir mayúsculas). */
const cumple = (texto: SQL, a: Atributo) => sql`${texto} ~* ${a.patron}`;

/**
 * Filtro por atributos: AND entre grupos, OR dentro del grupo (como
 * categorías y marcas). `excluirGrupo` deja afuera un grupo entero: lo usa la
 * faceta de ese grupo, que cuenta con los filtros de los OTROS. Sin ids
 * válidos (o todos del grupo excluido), `undefined`: no filtra.
 */
export function filtroAtributosSql(
  texto: SQL,
  ids: readonly string[] | undefined,
  excluirGrupo?: Atributo["grupo"],
): SQL | undefined {
  if (!ids?.length) return undefined;
  const condiciones = [...atributosPorGrupo(ids)]
    .filter(([grupo]) => grupo !== excluirGrupo)
    .map(([, atributos]) => or(...atributos.map((a) => cumple(texto, a))));
  return condiciones.length ? and(...condiciones) : undefined;
}

/**
 * Columnas de conteo para las facetas de atributos, en UNA consulta: por cada
 * atributo, `count(*) filter (where <filtros de los otros grupos> and <patrón>)`.
 * El WHERE de la consulta lleva todo lo demás (búsqueda, categorías, marcas,
 * precio, stock) y ningún atributo; cada columna suma los de los otros grupos.
 * Así cada grupo se cuenta con los filtros de los otros, igual que hoy las
 * categorías y las marcas: tildar "Luz cálida" no esconde "Luz fría".
 */
export function columnasConteoAtributos(texto: SQL, ids: readonly string[] | undefined) {
  return Object.fromEntries(
    ATRIBUTOS.map((a) => {
      const otros = filtroAtributosSql(texto, ids, a.grupo);
      const condicion = otros ? sql`${otros} and ${cumple(texto, a)}` : cumple(texto, a);
      return [a.id, sql<number>`count(*) filter (where ${condicion})::int`];
    }),
  ) as Record<string, SQL<number>>;
}

/**
 * Fila de conteos → facetas con conteo > 0, en el orden del diccionario. La
 * `label` es el id (lo que viaja en la URL); el nombre visible lo pone la UI.
 */
export function facetasDeConteos(fila: Record<string, unknown> | undefined): { label: string; count: number }[] {
  if (!fila) return [];
  return ATRIBUTOS.map((a) => ({ label: a.id, count: Number(fila[a.id] ?? 0) })).filter((f) => f.count > 0);
}
