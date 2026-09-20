import { and, eq, ne, or, isNull, sql, type SQL } from "drizzle-orm"
import { catalogProducts } from "@/db/schema"

/**
 * Qué productos se pueden ofrecer a un cliente.
 *
 * Vive en UN solo lugar a propósito: la misma regla la aplican el bot (`/api/agent/catalog`) y el
 * contrato que alimenta la tienda. Si cada uno la escribiera por su lado, tarde o temprano el bot
 * ofrecería algo que la tienda esconde, o al revés.
 *
 * En el espejo se guarda TODO lo que manda Alegra, incluidos los ítems dados de baja y los de
 * precio cero. El filtro se aplica al SERVIR, no al guardar: si mañana le ponés precio en Alegra
 * o lo reactivás, vuelve a aparecer solo en la próxima corrida, sin re-sincronizar nada.
 *
 * Tres condiciones, y las tres son independientes:
 *  - `status = 'active'`: lo vio la última corrida del sync. Lo que desapareció de Alegra se
 *    marca 'inactive' y deja de ofrecerse.
 *  - `alegra_status <> 'inactive'`: el ítem no está dado de baja EN Alegra. Se acepta null para
 *    los que todavía no pasaron por el sync nuevo, así estrenar esto no vacía el catálogo.
 *  - precio > 0: un producto sin precio no se puede vender. Son 315 de 8012 en Central Led.
 */
export function esVendible(): SQL {
  return and(
    eq(catalogProducts.status, "active"),
    or(isNull(catalogProducts.alegraStatus), ne(catalogProducts.alegraStatus, "inactive")),
    precioMayorACero(),
  ) as SQL
}

/**
 * El precio de lista más alto del ítem, mayor a cero.
 *
 * El guard de `jsonb_typeof` evita que `jsonb_array_elements` explote si algún ítem quedó con un
 * `prices` que no es un array.
 */
export function precioMayorACero(): SQL {
  return sql`coalesce((
    select max((elem->>'price')::numeric)
    from jsonb_array_elements(${catalogProducts.prices}) elem
    where jsonb_typeof(${catalogProducts.prices}) = 'array'
  ), 0) > 0`
}

/**
 * La misma regla, como texto SQL, para usarla dentro de una query cruda con un alias distinto.
 *
 * Duplicar la condición en dos formas es feo, pero lo es menos que tener dos reglas que pueden
 * divergir: los dos caminos salen de este archivo y se leen juntos.
 */
export function esVendibleSql(alias: string): SQL {
  return sql.raw(`(
    ${alias}.status = 'active'
    AND (${alias}.alegra_status IS NULL OR ${alias}.alegra_status <> 'inactive')
    AND coalesce((
      SELECT max((elem->>'price')::numeric)
      FROM jsonb_array_elements(${alias}.prices) elem
      WHERE jsonb_typeof(${alias}.prices) = 'array'
    ), 0) > 0
  )`)
}
