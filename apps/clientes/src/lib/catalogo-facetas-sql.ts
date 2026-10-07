/**
 * SQL de las facetas por tipo (change `catalogo-filtros-ux`).
 *
 * Dos piezas sobre `public.catalog_atributos` (una fila por producto y clave):
 *  - `filtroCaracteristicasSql`: el filtro ESTRICTO de `?car=` (catalogo-car.ts). Un `EXISTS` por clave
 *    contra la PK de la tabla: solo pasa el producto que TIENE el dato y lo cumple. OR dentro de la clave,
 *    AND entre claves. Nada que ver con `?atr=` (no contradicción, catalogo-atributos-sql.ts).
 *  - `consultaFacetasPorTipoSql`: los conteos de TODAS las claves del registro en UNA consulta. El
 *    conjunto base es el de la página sin ningún `car` ni potencia; por fila se marca cuántas claves
 *    activas incumple (`nfallas`) y cuál (`fallada`). Un producto cuenta para la clave K si no incumple
 *    ninguna, o si la única que incumple es K: así cada clave se cuenta con los filtros de las otras y
 *    sin el propio (tildar "Curva: C" no esconde B ni D). Los denominadores salen de la misma pasada.
 *
 * Todo valor viaja como parámetro; la clave también (sale del registro en código, y `leerIdCar` ya la
 * validó). Lo que el WHERE necesita de catalog.ts (el `EXISTS` contra el producto de la fila) llega
 * inyectado en `ContextoCar`, como en catalogo-atributos-sql.ts.
 *
 * SOLO servidor (lo importa catalog.ts).
 */
import { and, or, sql, type SQL } from "drizzle-orm";
import { crmAtributos } from "@/db/crm";
import { rangoDeClave } from "./catalogo-atributos-medida";
import { TIPO, type ClaveEstructurada } from "./catalogo-caracteristicas";
import { leerCar, leerIdCar } from "./catalogo-car";
import { REGISTRO, RE_VALOR_CAR, claveFacetable, rangoDeValorLista, type EntradaFacetas } from "./catalogo-facetas-registro";

/** `valor_num` y `valor_texto` de la fila de `catalog_atributos` dentro del `EXISTS`. */
export interface ColumnasAtributo {
  num: SQL;
  texto: SQL;
}

export interface ContextoCar extends ColumnasAtributo {
  /** `EXISTS` de la fila de `catalog_atributos` del producto con esa clave que cumple `condicion`. */
  existe: (clave: string, condicion: SQL) => SQL;
}

/** Extremos inclusivos de la potencia (W): `potencia_min`/`potencia_max`, la faceta de rango de potencia_w. */
export interface RangoPotencia {
  min?: number;
  max?: number;
}

const CLAVE_POTENCIA = "potencia_w";
/** Rango "a-b" en `valor_texto` (mismo patrón que `criterioSql` de catalogo-atributos-sql.ts). */
const RANGO_TEXTO = "^[0-9]+([.][0-9]+)?-[0-9]+([.][0-9]+)?$";
const ORDEN = new Map<string, number>(REGISTRO.map((c) => [c.clave, c.orden]));
const porOrden = (a: string, b: string) => (ORDEN.get(a) ?? 0) - (ORDEN.get(b) ?? 0);

function condicionPotencia(cols: ColumnasAtributo, p?: RangoPotencia): SQL | undefined {
  if (!p || (p.min == null && p.max == null)) return undefined;
  return and(p.min != null ? sql`${cols.num} >= ${p.min}` : undefined, p.max != null ? sql`${cols.num} <= ${p.max}` : undefined);
}

/**
 * Por clave activa, la condición sobre SU fila de `catalog_atributos` (OR de los ids de esa clave), en el
 * orden del registro. Los ids inválidos se descartan (`leerCar`). La potencia entra como `potencia_w`
 * cuando hay rango de potencia. En una clave con `rangoEnTexto` (corriente) el valor "4-6" es el rango de
 * `valor_texto` y el número suelto ("6") excluye a los que tienen rango: mismo reparto que los conteos.
 */
export function condicionesPorClave(cols: ColumnasAtributo, ids: readonly string[] | undefined, potencia?: RangoPotencia): Map<string, SQL> {
  const valores = new Map<string, (string | number)[]>();
  const rangos = new Map<string, SQL[]>();
  for (const id of leerCar(ids ?? [])) {
    const c = leerIdCar(id)!;
    if (c.op === "rango") {
      const lista = rangos.get(c.clave) ?? [];
      lista.push(sql`(${cols.num} >= ${c.min} and ${cols.num} <= ${c.max})`);
      rangos.set(c.clave, lista);
    } else {
      const lista = valores.get(c.clave) ?? [];
      const rango = rangoDeValorLista(c.clave, c.valor) !== null;
      lista.push(TIPO[c.clave as ClaveEstructurada] === "num" && !rango ? Number(c.valor) : c.valor);
      valores.set(c.clave, lista);
    }
  }
  const out = new Map<string, SQL>();
  const pot = condicionPotencia(cols, potencia);
  if (pot) out.set(CLAVE_POTENCIA, pot);
  for (const [clave, vs] of valores) {
    const num = TIPO[clave as ClaveEstructurada] === "num";
    if (num && claveFacetable(clave)?.rangoEnTexto) {
      const rangos = vs.filter((v) => rangoDeValorLista(clave, String(v)));
      const sueltos = vs.filter((v) => !rangoDeValorLista(clave, String(v))).map(Number);
      const partes: SQL[] = [];
      if (sueltos.length) {
        partes.push(sql`(${cols.num} in (${sql.join(sueltos.map((v) => sql`${v}`), sql`, `)}) and not coalesce(${cols.texto} ~ ${RANGO_TEXTO}, false))`);
      }
      if (rangos.length) partes.push(sql`${cols.texto} in (${sql.join(rangos.map((v) => sql`${String(v)}`), sql`, `)})`);
      out.set(clave, partes.length === 1 ? partes[0] : or(...partes)!);
      continue;
    }
    const columna = num ? cols.num : cols.texto;
    out.set(clave, sql`${columna} in (${sql.join(vs.map((v) => sql`${v}`), sql`, `)})`);
  }
  for (const [clave, partes] of rangos) out.set(clave, partes.length === 1 ? partes[0] : or(...partes)!);
  return new Map([...out].sort(([a], [b]) => porOrden(a, b)));
}

/** Las claves con filtro activo (car o potencia), en el orden del registro. */
export function clavesActivas(ids: readonly string[] | undefined, potencia?: RangoPotencia): string[] {
  return [...condicionesPorClave({ num: sql`n`, texto: sql`t` }, ids, potencia).keys()];
}

/**
 * Filtro estricto de `?car=`: un `EXISTS` por clave, AND entre claves. `excluirClave` deja afuera una.
 * `undefined` sin ids válidos: no filtra. La potencia NO entra (sigue en `potencia_min`/`potencia_max`).
 */
export function filtroCaracteristicasSql(ctx: ContextoCar, ids: readonly string[] | undefined, excluirClave?: string): SQL | undefined {
  const condiciones = [...condicionesPorClave(ctx, ids)].filter(([clave]) => clave !== excluirClave);
  return condiciones.length ? and(...condiciones.map(([clave, c]) => ctx.existe(clave, c))) : undefined;
}

/** Una columna booleana por clave activa (`c0`..`cn`, en el orden de `condiciones`): ¿el producto la cumple? */
export function columnasCumpleSql(ctx: ContextoCar, condiciones: ReadonlyMap<string, SQL>): Record<string, SQL> {
  return Object.fromEntries([...condiciones].map(([clave, c], i) => [`c${i}`, ctx.existe(clave, c)]));
}

/** Claves de la consulta: las del registro, con su control, si son numéricas, su rango válido y si listan rangos de texto. */
function registroValuesSql(): SQL {
  const filas = REGISTRO.map((c) => {
    const rango = rangoDeClave(c.clave);
    const num = TIPO[c.clave] === "num";
    return sql`(${c.clave}::text, ${c.control}::text, ${num}::boolean, ${rango?.[0] ?? null}::numeric, ${rango?.[1] ?? null}::numeric, ${Boolean(c.rangoEnTexto)}::boolean)`;
  });
  return sql.join(filas, sql`, `);
}

/**
 * Conteos de las facetas por tipo en UNA consulta. `base` es el SELECT del conjunto sin `car` ni potencia
 * con la columna `id` (alegra_id) y, si hay claves `activas`, una columna booleana `c<i>` por cada una
 * (`columnasCumpleSql`, mismo orden). Devuelve filas `(tipo, clave, valor, n, min, max)`:
 *  - `lista`: cuántos productos tienen cada valor de una clave de lista (en una clave con `rangoEnTexto`, el
 *    rango de `valor_texto` es su propio valor: "4-6" aparte de "6");
 *  - `rango`: extremos y cantidad de productos con dato de una clave de rango;
 *  - `denominador`: con `clave` null, los productos que cumplen todo; con clave K, los que solo fallan K.
 * Los valores fuera del rango válido (RANGOS) o con forma inválida no cuentan.
 */
export function consultaFacetasPorTipoSql(a: { base: SQL; activas: readonly string[]; tenant: string }): SQL {
  const col = (i: number) => sql.identifier(`c${i}`);
  const nfallas = a.activas.length ? sql.join(a.activas.map((_, i) => sql`(case when ${col(i)} then 0 else 1 end)`), sql` + `) : sql`0`;
  const fallada = a.activas.length
    ? sql`(case ${sql.join(a.activas.map((clave, i) => sql`when not ${col(i)} then ${clave}::text`), sql` `)} end)`
    : sql`null::text`;
  const filtroFallas = a.activas.length ? sql` where nfallas <= 1` : sql``;
  return sql`with base as (${a.base}),
filas as materialized (
  select id, fallada from (select id, ${nfallas} as nfallas, ${fallada} as fallada from base) x${filtroFallas}
),
reg (clave, control, num, lo, hi, rangotexto) as (values ${registroValuesSql()})
select reg.control as tipo, ${crmAtributos.clave} as clave,
  (case when reg.control = 'lista' then (case
    when reg.num and reg.rangotexto and ${crmAtributos.valorTexto} ~ ${RANGO_TEXTO} then ${crmAtributos.valorTexto}
    when reg.num then ${crmAtributos.valorNum}::text
    else ${crmAtributos.valorTexto} end) end) as valor,
  count(*)::int as n, min(${crmAtributos.valorNum})::float8 as min, max(${crmAtributos.valorNum})::float8 as max
from filas f
join ${crmAtributos} on ${crmAtributos.tenantId} = ${a.tenant} and ${crmAtributos.alegraId} = f.id
  and (f.fallada is null or f.fallada = ${crmAtributos.clave})
join reg on reg.clave = ${crmAtributos.clave}
where (case when reg.num
  then ${crmAtributos.valorNum} is not null and (reg.lo is null or ${crmAtributos.valorNum} >= reg.lo) and (reg.hi is null or ${crmAtributos.valorNum} <= reg.hi)
  else ${crmAtributos.valorTexto} ~ ${RE_VALOR_CAR.source} end)
group by 1, 2, 3
union all
select 'denominador', fallada, null, count(*)::int, null, null from filas group by fallada`;
}

/** Una fila de `consultaFacetasPorTipoSql` tal como la devuelve el driver (numeric puede llegar como texto). */
export interface FilaFacetasPorTipo {
  tipo: string;
  clave: string | null;
  valor: string | null;
  n: number | string;
  min: number | string | null;
  max: number | string | null;
}

const numero = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** Filas de la consulta → la entrada de `elegirFacetas`. Los números de lista se normalizan ("2.00" → "2"). */
export function entradaDeFilas(filas: readonly FilaFacetasPorTipo[], activas: readonly string[], categoria?: string): EntradaFacetas {
  const porValor = new Map<string, { clave: string; valor: string; n: number }>();
  const rangos: EntradaFacetas["rangos"][number][] = [];
  const fallas: Record<string, number> = {};
  let total = 0;
  for (const f of filas) {
    const n = numero(f.n);
    if (!Number.isFinite(n)) continue;
    if (f.tipo === "denominador") {
      if (f.clave == null) total += n;
      else fallas[f.clave] = (fallas[f.clave] ?? 0) + n;
      continue;
    }
    if (!f.clave || !claveFacetable(f.clave)) continue;
    if (f.tipo === "rango") {
      const min = numero(f.min);
      const max = numero(f.max);
      if (Number.isFinite(min) && Number.isFinite(max)) rangos.push({ clave: f.clave, min, max, n });
      continue;
    }
    if (f.tipo !== "lista" || f.valor == null) continue;
    let valor = f.valor;
    if (TIPO[f.clave as ClaveEstructurada] === "num" && !rangoDeValorLista(f.clave, valor)) {
      const v = numero(valor);
      if (!Number.isFinite(v)) continue;
      valor = String(v);
    }
    const k = `${f.clave}\u0000${valor}`;
    const previo = porValor.get(k);
    if (previo) previo.n += n;
    else porValor.set(k, { clave: f.clave, valor, n });
  }
  const denominadores = Object.fromEntries(REGISTRO.map((c) => [c.clave, total + (fallas[c.clave] ?? 0)]));
  return { filas: [...porValor.values()], rangos, denominadores, activas: [...activas], ...(categoria ? { categoria } : {}) };
}
