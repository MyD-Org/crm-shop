/**
 * Cliente de drizzle que NO se conecta a nada: anota el SQL que el código bajo
 * prueba le manda ejecutar y contesta lo que el test le indique.
 *
 * Sirve para probar la FORMA de una consulta (a qué esquema le pega, qué filtra,
 * qué escribe) ejecutando la función real, sin exportar cada query builder solo
 * para poder llamarle `.toSQL()`. Es el driver `pg-proxy` de drizzle: el SQL lo
 * arma el mismo dialecto de Postgres que en producción.
 *
 * Solo para tests. Nada de `src/` fuera de un `*.test.ts` debe importarlo.
 */
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "../schema";

export type ConsultaGrabada = { sql: string; params: unknown[] };

/**
 * Filas a devolver para una consulta. En `pg-proxy` cada fila es un ARRAY con
 * los valores en el orden de las columnas seleccionadas, no un objeto.
 */
type Responder = (consulta: ConsultaGrabada) => unknown[][] | undefined;

export function dbGrabadora(responder: Responder = () => undefined) {
  const consultas: ConsultaGrabada[] = [];

  const db = drizzle(
    async (sql, params) => {
      const consulta = { sql, params };
      consultas.push(consulta);
      return { rows: responder(consulta) ?? [] };
    },
    { schema },
  );

  // `pg-proxy` no soporta transacciones (tira al llamarlas). Para mirar el SQL
  // alcanza con correr el callback sobre el mismo cliente.
  Object.assign(db, {
    transaction: (fn: (tx: typeof db) => unknown) => fn(db),
  });

  return { db, consultas };
}

/**
 * La lectura del árbol de categorías propias que hacen `getFacetas` y
 * `getCategorias` antes de consultar productos. Los tests que miran la forma de
 * las consultas de productos la descartan con esto.
 */
export const esLecturaDelArbol = (c: ConsultaGrabada) =>
  /^select [^()]* from "public"\."shop_categories" where/.test(c.sql);

/** Las consultas grabadas, sin la lectura del árbol de categorías. */
export const sinLecturaDelArbol = (consultas: ConsultaGrabada[]) =>
  consultas.filter((c) => !esLecturaDelArbol(c));

/**
 * Parte un `insert into … (cols) values (vals)` de UNA fila en un mapa
 * columna → valor real. `default` queda como la cadena "default": es lo que
 * drizzle emite para las columnas que el código no seteó.
 */
export function valoresInsertados(
  consulta: ConsultaGrabada,
): Record<string, unknown> {
  const m = consulta.sql.match(/^insert into \S+ \(([^)]*)\) values \(([^)]*)\)/);
  if (!m) throw new Error(`No es un insert de una fila: ${consulta.sql}`);
  const columnas = m[1].split(", ").map((c) => c.replaceAll('"', ""));
  const valores = m[2].split(", ");
  return Object.fromEntries(
    columnas.map((columna, i) => {
      const token = valores[i];
      const param = token.match(/^\$(\d+)$/);
      return [columna, param ? consulta.params[Number(param[1]) - 1] : token];
    }),
  );
}
