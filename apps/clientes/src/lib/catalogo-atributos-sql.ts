/**
 * SQL del filtro y de las facetas de atributos (`?atr=`, ver
 * catalogo-atributos.ts). Vive aparte de catalog.ts para que ése no siga
 * creciendo; recibe el texto buscable ya normalizado (`textoBuscableSql()` de
 * catalog.ts: `immutable_unaccent(lower(...))`) como expresión.
 *
 * El patrón viaja como PARÁMETRO (`$n`), nunca interpolado: sale del
 * diccionario en código, pero así ni siquiera hace falta escaparlo.
 *
 * Fase 2 (fichas estructuradas): con `attrs` (el jsonb `{clave: {n, t}}` de
 * `public.catalog_atributos` del producto, ver `atributosFilaSql` en
 * catalog.ts) cada atributo mira PRIMERO el dato estructurado de su clave y, si
 * el producto no lo tiene, el patrón (`coalesce(<estructurado>, <patrón>)`).
 * Sin `attrs` (flag apagado o tabla sin migrar) el SQL es el de la fase 1.
 *
 * SOLO servidor (lo importa catalog.ts).
 */
import { and, or, sql, type SQL } from "drizzle-orm";
import { ATRIBUTOS, atributosPorGrupo, type Atributo, type CriterioEstructurado } from "./catalogo-atributos";
import type { ClaveEstructurada } from "./catalogo-caracteristicas";

/** Lo que necesita cada condición: el texto normalizado y, si hay, los atributos estructurados. */
export interface ContextoAtributos {
  texto: SQL;
  /** jsonb `{clave: {n, t}}` del producto (NULL si no tiene ninguno). */
  attrs?: SQL;
}

/**
 * `attrs -> 'clave'`. La clave va literal (no como parámetro: `jsonb -> $1` es ambiguo entre el
 * operador de texto y el de índice). Sale de una lista cerrada en código; igual se valida.
 */
function valorDe(attrs: SQL, clave: ClaveEstructurada): SQL {
  if (!/^[a-z_]+$/.test(clave)) throw new Error(`clave inválida: ${clave}`);
  return sql`(${attrs} -> ${sql.raw(`'${clave}'`)})`;
}

/** `valor_num` de una clave, como numeric (NULL si no hay). */
export function numeroDe(attrs: SQL, clave: ClaveEstructurada): SQL {
  return sql`(${valorDe(attrs, clave)} ->> 'n')::numeric`;
}

const textoDe = (attrs: SQL, clave: ClaveEstructurada) => sql`(${valorDe(attrs, clave)} ->> 't')`;

/** Rango "a-b" en `valor_texto`. */
const RANGO = "^[0-9]+([.][0-9]+)?-[0-9]+([.][0-9]+)?$";

/**
 * Condición estructurada: NULL si el producto no tiene dato para la clave (decide el patrón);
 * si lo tiene, verdadero o falso. Mismo criterio que `cumpleEstructurado` (JS).
 */
function cumpleEstructuradoSql(attrs: SQL, c: CriterioEstructurado): SQL {
  const n = numeroDe(attrs, c.clave);
  const t = textoDe(attrs, c.clave);
  const partes: SQL[] = [];
  if (c.textos?.length) partes.push(sql`${t} in (${sql.join(c.textos.map((x) => sql`${x}`), sql`, `)})`);
  if (c.numeros?.length) partes.push(sql`${n} in (${sql.join(c.numeros.map((x) => sql`${x}`), sql`, `)})`);
  if (c.desde != null || c.hasta != null) {
    partes.push(
      and(
        c.desde != null ? sql`${n} >= ${c.desde}` : undefined,
        c.hasta != null ? sql`${n} <= ${c.hasta}` : undefined,
      )!,
    );
  }
  if (c.enRango != null) {
    // CASE: el cast sólo corre si el texto ES un rango (un texto manual raro no rompe la consulta).
    partes.push(sql`(case when ${t} ~ ${RANGO} then split_part(${t}, '-', 1)::numeric <= ${c.enRango}
      and split_part(${t}, '-', 2)::numeric >= ${c.enRango} else false end)`);
  }
  return sql`(case when ${valorDe(attrs, c.clave)} is not null then coalesce(${or(...partes)}, false) end)`;
}

/** El producto cumple un atributo: estructurado primero (si hay `attrs`), si no el patrón (`~*`). */
function cumple(ctx: ContextoAtributos, a: Atributo): SQL {
  const patron = sql`${ctx.texto} ~* ${a.patron}`;
  if (!ctx.attrs || !a.estructurado) return patron;
  return sql`coalesce(${cumpleEstructuradoSql(ctx.attrs, a.estructurado)}, ${patron})`;
}

/**
 * Filtro por atributos: AND entre grupos, OR dentro del grupo (como
 * categorías y marcas). `excluirGrupo` deja afuera un grupo entero: lo usa la
 * faceta de ese grupo, que cuenta con los filtros de los OTROS. Sin ids
 * válidos (o todos del grupo excluido), `undefined`: no filtra.
 */
export function filtroAtributosSql(
  ctx: ContextoAtributos,
  ids: readonly string[] | undefined,
  excluirGrupo?: Atributo["grupo"],
): SQL | undefined {
  if (!ids?.length) return undefined;
  const condiciones = [...atributosPorGrupo(ids)]
    .filter(([grupo]) => grupo !== excluirGrupo)
    .map(([, atributos]) => or(...atributos.map((a) => cumple(ctx, a))));
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
export function columnasConteoAtributos(ctx: ContextoAtributos, ids: readonly string[] | undefined) {
  return Object.fromEntries(
    ATRIBUTOS.map((a) => {
      const otros = filtroAtributosSql(ctx, ids, a.grupo);
      const condicion = otros ? sql`${otros} and ${cumple(ctx, a)}` : cumple(ctx, a);
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
