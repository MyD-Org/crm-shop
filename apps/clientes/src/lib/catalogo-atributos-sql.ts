/**
 * SQL del filtro y de las facetas de atributos (`?atr=`, ver
 * catalogo-atributos.ts). Vive aparte de catalog.ts para que ése no siga
 * creciendo; recibe el texto buscable ya normalizado (`textoBuscableSql()` de
 * catalog.ts: `immutable_unaccent(lower(...))`) como expresión.
 *
 * El patrón viaja como PARÁMETRO (`$n`), nunca interpolado: sale del
 * diccionario en código, pero así ni siquiera hace falta escaparlo.
 *
 * Fase 2 (fichas estructuradas): un producto cumple un atributo si cumple el
 * dato estructurado de su clave (`public.catalog_atributos`) O el patrón:
 * `(coalesce(<estructurado>, false) or <patrón>)`. El estructurado sólo SUMA
 * productos (la cobertura sólo sube). Dos formas de leer el dato, con el mismo
 * resultado (`criterioSql` sobre un número y un texto):
 * - en el WHERE, `existe`: un `EXISTS` por atributo contra la PK de la tabla
 *   (una sola búsqueda de índice por producto y atributo, sin armar jsonb);
 * - en las facetas, `attrs`: el jsonb `{clave: {n, t}}` que la subconsulta de
 *   conteo arma UNA vez por fila (ver `atributosFilaSql` en catalog.ts).
 * Sin ninguna de las dos (flag apagado o tabla sin migrar) el SQL es el de la fase 1.
 *
 * Medidas (ids dinámicos `corriente_a:20`, ver `AtributoMedida`): dos semánticas sobre el mismo
 * dato. En el FILTRO, por defecto, "sin contradicción" (`sinContradiccionSql`): pasa el producto
 * que no tiene dato de esa clave o cuyo dato cumple; solo queda afuera el que tiene la clave con
 * OTRO valor (un termomagnético sin la corriente cargada no desaparece por eso). Con
 * `medidaPositiva` (consulta de puras medidas, sin categoría ni términos que acoten), "positivo":
 * solo el que cumple (dato O patrón del nombre), porque sin universo "sin contradicción"
 * devolvería el catálogo entero. El BOOST y la recuperación usan siempre el positivo
 * (`cumpleAtributoSql`). Todo valor viaja como parámetro; la clave sale de la lista cerrada.
 *
 * SOLO servidor (lo importa catalog.ts).
 */
import { and, or, sql, type SQL } from "drizzle-orm";
import {
  ATRIBUTOS,
  atributoPorId,
  atributosPorGrupo,
  type Atributo,
  type AtributoMedida,
  type CriterioEstructurado,
  type GrupoAtributo,
} from "./catalogo-atributos";
import type { ClaveEstructurada } from "./catalogo-caracteristicas";

/** Lo que necesita cada condición: el texto normalizado y, si hay, cómo leer los estructurados. */
export interface ContextoAtributos {
  texto: SQL;
  /** jsonb `{clave: {n, t}}` del producto (NULL si no tiene ninguno). Para la consulta de facetas. */
  attrs?: SQL;
  /**
   * `EXISTS` de una fila de `catalog_atributos` del producto con esa clave que cumple el
   * criterio (lo arma catalog.ts, que conoce la tabla y el producto). Para el WHERE.
   */
  existe?: (c: CriterioEstructurado) => SQL;
  /**
   * `EXISTS` de una fila de `catalog_atributos` del producto con esa clave que tiene dato y NO
   * cumple el criterio (se arma con `contradiccionSql`). Para el WHERE de las medidas.
   */
  contradice?: (c: CriterioEstructurado) => SQL;
  /** `EXISTS` de una fila del producto con esa clave, con cualquier valor (cobertura). Para el WHERE. */
  tiene?: (clave: ClaveEstructurada) => SQL;
  /**
   * Las medidas filtran en modo positivo (solo lo que cumple) en vez de "sin contradicción".
   * Lo decide quien arma el contexto (catalog.ts, ver `universoAcotado`).
   */
  medidaPositiva?: boolean;
}

/**
 * `attrs -> 'clave'`. La clave va literal (no como parámetro: `jsonb -> $1` es ambiguo entre el
 * operador de texto y el de índice). Sale de una lista cerrada en código; igual se valida.
 */
function valorDe(attrs: SQL, clave: ClaveEstructurada): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(clave)) throw new Error(`clave inválida: ${clave}`);
  return sql`(${attrs} -> ${sql.raw(`'${clave}'`)})`;
}

/** `valor_num` de una clave del jsonb, como numeric (NULL si no hay). */
export function numeroDe(attrs: SQL, clave: ClaveEstructurada): SQL {
  return sql`(${valorDe(attrs, clave)} ->> 'n')::numeric`;
}

const textoDe = (attrs: SQL, clave: ClaveEstructurada) => sql`(${valorDe(attrs, clave)} ->> 't')`;

/** Rango "a-b" en `valor_texto`. */
const RANGO = "^[0-9]+([.][0-9]+)?-[0-9]+([.][0-9]+)?$";

/**
 * El criterio sobre un `valor_num` (`n`) y un `valor_texto` (`t`): verdadero si cumple alguna de
 * sus partes; NULL/falso si no (sin dato, todo da NULL). Mismo criterio que `cumpleEstructurado`.
 */
export function criterioSql(c: CriterioEstructurado, n: SQL, t: SQL): SQL {
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
  return or(...partes)!;
}

/** Condición estructurada (nunca NULL): con `existe` en el WHERE, con `attrs` en las facetas. */
function estructuradoSql(ctx: ContextoAtributos, c: CriterioEstructurado): SQL | undefined {
  if (ctx.existe) return ctx.existe(c);
  if (ctx.attrs) return sql`coalesce(${criterioSql(c, numeroDe(ctx.attrs, c.clave), textoDe(ctx.attrs, c.clave))}, false)`;
  return undefined;
}

/** El producto cumple un atributo: el dato estructurado O el patrón (`~*`). */
function cumple(ctx: ContextoAtributos, a: Atributo): SQL {
  const patron = sql`${ctx.texto} ~* ${a.patron}`;
  const estructurado = a.estructurado ? estructuradoSql(ctx, a.estructurado) : undefined;
  return estructurado ? sql`(${estructurado} or ${patron})` : patron;
}

/**
 * La fila CONTRADICE el criterio: tiene dato de la clave (número, texto o cualquiera de los dos, según
 * el criterio) y ese dato no lo cumple. Nunca NULL (`coalesce` a falso): su negación tampoco.
 */
export function contradiccionSql(c: CriterioEstructurado, n: SQL, t: SQL): SQL {
  const usaNumero = Boolean(c.numeros?.length) || c.desde != null || c.hasta != null;
  const usaTexto = Boolean(c.textos?.length) || c.enRango != null;
  const hayDato = usaNumero && usaTexto ? sql`(${n} is not null or ${t} is not null)` : usaTexto ? sql`${t} is not null` : sql`${n} is not null`;
  return sql`(${hayDato} and not coalesce(${criterioSql(c, n, t)}, false))`;
}

/**
 * El producto NO contradice el criterio: no tiene dato de la clave, o el que tiene lo cumple. En el
 * WHERE con `contradice` (un `NOT EXISTS` contra la PK de la tabla), en las facetas con el jsonb.
 * `undefined` sin datos estructurados: no hay con qué contradecir y el filtro no restringe.
 */
export function sinContradiccionSql(ctx: ContextoAtributos, c: CriterioEstructurado): SQL | undefined {
  if (ctx.contradice) return sql`not ${ctx.contradice(c)}`;
  if (ctx.attrs) return sql`not ${contradiccionSql(c, numeroDe(ctx.attrs, c.clave), textoDe(ctx.attrs, c.clave))}`;
  return undefined;
}

/** El producto tiene dato de la clave (cualquiera). `undefined` sin datos estructurados. */
export function tieneClaveSql(ctx: ContextoAtributos, clave: ClaveEstructurada): SQL | undefined {
  if (ctx.tiene) return ctx.tiene(clave);
  if (ctx.attrs) return sql`${valorDe(ctx.attrs, clave)} is not null`;
  return undefined;
}

/**
 * El producto CONTRADICE el atributo: tiene dato estructurado de la clave y es otro valor. Es el negativo del orden
 * estricto de las medidas discretas (`puntajeBusqueda`); nunca filtra. Misma pieza que `sinContradiccionSql` sin
 * negar. `undefined` si el id no existe, no tiene criterio estructurado o no hay datos estructurados.
 */
export function contradiceAtributoSql(ctx: ContextoAtributos, id: string): SQL | undefined {
  const c = atributoPorId(id)?.estructurado;
  if (!c) return undefined;
  if (ctx.contradice) return ctx.contradice(c);
  if (ctx.attrs) return contradiccionSql(c, numeroDe(ctx.attrs, c.clave), textoDe(ctx.attrs, c.clave));
  return undefined;
}

/** Una medida cumple en positivo: el dato estructurado O el patrón del nombre (el que haya). */
function cumpleMedida(ctx: ContextoAtributos, a: AtributoMedida): SQL | undefined {
  const patron = a.patron ? sql`${ctx.texto} ~* ${a.patron}` : undefined;
  const estructurado = estructuradoSql(ctx, a.estructurado);
  return estructurado && patron ? sql`(${estructurado} or ${patron})` : (estructurado ?? patron);
}

/** Una medida como condición del filtro: positiva o sin contradicción (ver el encabezado). */
function condicionMedida(ctx: ContextoAtributos, a: AtributoMedida): SQL | undefined {
  // Sin datos estructurados las medidas no filtran: no hay contra qué comparar.
  if (!ctx.existe && !ctx.attrs) return undefined;
  return ctx.medidaPositiva ? cumpleMedida(ctx, a) : sinContradiccionSql(ctx, a.estructurado);
}

/**
 * El producto cumple el atributo en POSITIVO (dato estructurado O patrón), sea cual sea el modo del
 * contexto: es lo que ordena (el boost) y recupera. `undefined` si el id no existe. Para un id del
 * diccionario es el mismo SQL que filtrarlo.
 */
export function cumpleAtributoSql(ctx: ContextoAtributos, id: string): SQL | undefined {
  const a = atributoPorId(id);
  if (!a) return undefined;
  return "medida" in a ? cumpleMedida(ctx, a) : filtroAtributosSql(ctx, [id]);
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
  excluirGrupo?: GrupoAtributo,
): SQL | undefined {
  if (!ids?.length) return undefined;
  const condiciones = [...atributosPorGrupo(ids)]
    .filter(([grupo]) => grupo !== excluirGrupo)
    .map(([, atributos]) => or(...atributos.map((a) => ("medida" in a ? condicionMedida(ctx, a) : cumple(ctx, a)))));
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
