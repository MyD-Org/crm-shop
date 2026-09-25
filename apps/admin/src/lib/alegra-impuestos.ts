/**
 * Regla única de impuestos del ítem de Alegra: la SUMA de `percentage` de todos los elementos de
 * `tax`, sin interpretar qué impuesto es cada uno (IVA, percepción, etc.).
 *
 * Es el espejo EXACTO de `public.alegra_suma_impuestos(jsonb)` (drizzle/0037): la sync y el
 * drenador de webhooks escriben `catalog_products.iva_porcentaje` con esta función, y la
 * migración recalculó lo ya guardado con la SQL. Las ata el vector
 * `__fixtures__/impuestos-alegra.json`, que se prueba contra las dos. Si se cambia una, se
 * cambia la otra en una migración nueva.
 *
 * - `tax` no es un array → null.
 * - Cuenta `percentage` si es un número JSON (negativos incluidos) o un string que, quitando SÓLO
 *   espacios (U+0020) de los extremos, matchea NUMERO. Todo lo demás se ignora.
 * - Ningún elemento cuenta → null. Si no, la suma.
 *
 * Es más estricta que `Number()` de JS (hex, "1e2", booleanos, tabuladores) a propósito: así SQL
 * la replica al pie de la letra.
 */
const NUMERO = /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/

export function sumaImpuestos(tax: unknown): number | null {
  if (!Array.isArray(tax)) return null
  let suma = 0
  let cuenta = false
  for (const e of tax) {
    if (e === null || typeof e !== "object" || Array.isArray(e)) continue
    const p = (e as { percentage?: unknown }).percentage
    if (typeof p === "number" && Number.isFinite(p)) {
      suma += p
      cuenta = true
    } else if (typeof p === "string") {
      const s = p.replace(/^ +| +$/g, "")
      if (NUMERO.test(s)) {
        suma += Number(s)
        cuenta = true
      }
    }
  }
  return cuenta ? suma : null
}
