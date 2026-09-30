/**
 * `interpretar(q)` con las dependencias de verdad: árbol de categorías del
 * tenant (deduplicado por request), Jev con `JEV_API_KEY` y la caché en
 * `shop.busqueda_interpretaciones`. SOLO servidor.
 *
 * Quien llama decide si corresponde (flag `busqueda-ia`, `debeInterpretar`,
 * sin `ia=` en la URL). Nunca tira: si el árbol no se puede leer, se
 * interpreta sin categorías; la caché y Jev ya degradan solos.
 */
import { getArbolCategorias } from "../catalog";
import { shopTenantId } from "../tenant";
import { guardarInterpretacion, leerInterpretacion } from "./cache";
import { interpretarCon } from "./interpretar";
import { consultarJev } from "./jev";
import type { Interpretacion, NodoArbol } from "./tipos";

export async function interpretar(
  q: string,
  opciones: {
    /** `false` en la página ya interpretada (`?ia=`): lee la caché sin sumar un uso. */
    sumarUso?: boolean;
  } = {},
): Promise<Interpretacion | null> {
  try {
    const tenant = shopTenantId();
    const arbol: NodoArbol[] = await getArbolCategorias().catch((err: unknown) => {
      console.error(`[busqueda-ia] no se pudo leer el árbol: ${err instanceof Error ? err.name : "desconocido"}`);
      return [];
    });
    return await interpretarCon(q, {
      arbol,
      jev: process.env.JEV_API_KEY?.trim() ? (consulta, preguntas) => consultarJev(consulta, preguntas) : null,
      leerCache: (norm, hash) => leerInterpretacion(tenant, norm, hash, opciones.sumarUso ?? true),
      guardarCache: (norm, hash, guardado) => guardarInterpretacion(tenant, norm, hash, guardado),
    });
  } catch (err) {
    console.error(`[busqueda-ia] no se pudo interpretar: ${err instanceof Error ? err.name : "desconocido"}`);
    return null;
  }
}
