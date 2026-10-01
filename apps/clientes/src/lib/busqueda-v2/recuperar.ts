/**
 * RECUPERAR (spec búsqueda v2): la condición SQL de candidatos. Módulo puro.
 *
 *   duros (categorías Y atributos de la URL, como los filtros de siempre)
 *   Y ( algún término que recupera (original o expandido, al comienzo de palabra)
 *       O producto en alguna categoría blanda
 *       O producto con algún atributo blando )
 *
 * Esta función arma sólo el paréntesis: los duros, la marca, el precio, el
 * stock y la potencia los sigue poniendo `condicionesDe` en catalog.ts.
 *
 * Dos niveles, para no traer el catálogo entero cuando ya hay por dónde:
 * - FUERTES: términos y categorías blandas con peso ≥ `PESO_MINIMO_RECUPERAR`.
 * - DÉBILES: categorías blandas de menos peso (la raíz, que entra a mitad de su
 *   confianza; una subcategoría dudosa) y los atributos blandos (tono,
 *   ambiente, un atributo explícito con pocos productos). Recuperan SÓLO si no
 *   hay ningún fuerte: "iluminar un cartel de noche" no tiene términos que
 *   recuperen y vive de sus categorías; "farol para la entrada" no necesita
 *   traer cada producto IP65 (cajas estancas incluidas) para ordenar los
 *   faroles exteriores arriba. Débiles o no, todos ORDENAN (ordenar.ts).
 *
 * Sin nada que recupere, `undefined` (ver `condicionesDe`).
 */
import { or, sql, type SQL } from "drizzle-orm";
import { PESO_MINIMO_RECUPERAR } from "./plan";
import { patronTermino, type CriterioPlan, type PiezasBusqueda } from "./piezas";

/** Términos del plan que recuperan (los de contexto y las medidas sólo ordenan). */
export function terminosQueRecuperan(plan: CriterioPlan): string[] {
  return plan.blandos.terminos.filter((t) => t.peso >= PESO_MINIMO_RECUPERAR).map((t) => t.texto);
}

/**
 * Último recurso, sin duros ni nada que recupere ("iluminar un cartel de noche" sin Jev): algún
 * término del plan, aunque sea de contexto. Mejor algo que la nada del AND clásico.
 */
export function condicionAmplia(plan: CriterioPlan, p: PiezasBusqueda): SQL | undefined {
  const partes = plan.blandos.terminos.map((t) => sql`${p.texto} ~ ${patronTermino(t.texto)}`);
  if (!partes.length) return undefined;
  return partes.length === 1 ? partes[0] : or(...partes);
}

export function condicionRecuperar(plan: CriterioPlan, p: PiezasBusqueda): SQL | undefined {
  const fuertes: SQL[] = terminosQueRecuperan(plan).map((t) => sql`${p.texto} ~ ${patronTermino(t)}`);
  const categoriasFuertes = plan.blandos.categorias.filter((c) => c.peso >= PESO_MINIMO_RECUPERAR).map((c) => c.nombre);
  if (categoriasFuertes.length) fuertes.push(p.enCategorias(categoriasFuertes));
  const partes = fuertes.length ? fuertes : debiles(plan, p);
  if (!partes.length) return undefined;
  return partes.length === 1 ? partes[0] : or(...partes);
}

function debiles(plan: CriterioPlan, p: PiezasBusqueda): SQL[] {
  const partes: SQL[] = [];
  const categorias = plan.blandos.categorias.map((c) => c.nombre);
  if (categorias.length) partes.push(p.enCategorias(categorias));
  for (const a of plan.blandos.atributos) {
    const cumple = p.cumpleAtributo(a.id);
    if (cumple) partes.push(cumple);
  }
  return partes;
}
