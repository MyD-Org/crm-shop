/**
 * `interpretar(q)` con las dependencias de verdad: árbol de categorías del
 * tenant (deduplicado por request), Jev con `JEV_API_KEY` y la caché en
 * `shop.busqueda_interpretaciones`. SOLO servidor.
 *
 * Quien llama decide si corresponde (flag `busqueda-ia`, `debeInterpretar`).
 * Nunca tira: si el árbol no se puede leer, se interpreta sin categorías; la
 * caché y Jev ya degradan solos. Jev tiene tope por IP y global (limite.ts).
 */
import { headers } from "next/headers";
import { getArbolCategorias } from "../catalog";
import { shopTenantId } from "../tenant";
import { guardarInterpretacion, leerInterpretacion } from "./cache";
import { interpretarCon } from "./interpretar";
import { consultarJev } from "./jev";
import { jevConTope } from "./limite";
import type { Interpretacion, NodoArbol } from "./tipos";

export async function interpretar(
  q: string,
  opciones: {
    /** `false`: lee la caché sin sumar un uso (páginas siguientes de una búsqueda). */
    sumarUso?: boolean;
    /**
     * Sólo lectura (la página ya interpretada, `?ia=`): caché sin sumar uso y,
     * si no está, lo determinista. Nunca llama a Jev ni escribe la caché: una
     * URL con `ia=` inventado no puede gastar nada.
     */
    soloLectura?: boolean;
  } = {},
): Promise<Interpretacion | null> {
  try {
    const tenant = shopTenantId();
    const arbol: NodoArbol[] = await getArbolCategorias().catch((err: unknown) => {
      console.error(`[busqueda-ia] no se pudo leer el árbol: ${err instanceof Error ? err.name : "desconocido"}`);
      return [];
    });
    const soloLectura = opciones.soloLectura ?? false;
    const conJev = !soloLectura && !!process.env.JEV_API_KEY?.trim();
    return await interpretarCon(q, {
      arbol,
      jev: conJev
        ? jevConTope(
            (consulta, preguntas, timeoutMs) => consultarJev(consulta, preguntas, { timeoutMs }),
            await ipDelVisitante(),
          )
        : null,
      leerCache: (norm, hash) => leerInterpretacion(tenant, norm, hash, !soloLectura && (opciones.sumarUso ?? true)),
      guardarCache: soloLectura
        ? async () => {}
        : (norm, hash, guardado) => guardarInterpretacion(tenant, norm, hash, guardado),
    });
  } catch (err) {
    console.error(`[busqueda-ia] no se pudo interpretar: ${err instanceof Error ? err.name : "desconocido"}`);
    return null;
  }
}

/** IP del visitante para el tope de Jev (la primera de `x-forwarded-for`). */
async function ipDelVisitante(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "sin-ip";
}
