/**
 * Copia el catálogo comercial del CRM a la DB del Shop (contrato catalogo-overlay/v1).
 *
 * El Shop NUNCA le pregunta al CRM para renderizar una página: copia acá y después lee de su
 * propia base. Una caída del CRM significa que el catálogo no se actualiza, no que la tienda
 * deje de funcionar.
 *
 * Reglas, las mismas que cuotas:
 *  - **Última copia buena**: si el CRM falla o devuelve algo inválido, lo ya copiado queda
 *    intacto y sólo se registra el error. Es preferible una tienda con datos de ayer a una vacía.
 *  - **Taxonomía por reemplazo atómico**: categorías y tags viajan enteros y se reemplazan en una
 *    transacción. Un merge parcial dejaría el árbol a medias si se corta a mitad.
 *  - **Overlay por delta**: se piden las páginas desde el último cursor. El cursor sólo avanza si
 *    la página se guardó, así que un corte reanuda donde quedó en vez de empezar de cero.
 *
 * La persistencia va detrás de `RepoCatalogo` para poder probar la lógica sin DB.
 */
import { parsearOverlay, parsearTaxonomia, type ContratoOverlay, type ContratoTaxonomia } from "./catalogo-contrato";

export type TriggerSync = "cron" | "ping" | "manual";

/** Tope de páginas por corrida: una salvaguarda contra un cursor que no avance. */
export const MAX_PAGINAS = 200;

export interface Cursor {
  desde: string;
  cursor: string;
}

export interface RepoCatalogo {
  /** Reemplaza el árbol y el diccionario de tags en UNA transacción. */
  reemplazarTaxonomia(t: ContratoTaxonomia, ahora: Date): Promise<void>;
  /** Aplica una página del delta y avanza el cursor en la MISMA transacción. */
  aplicarPaginaOverlay(items: ContratoOverlay["items"], cursor: Cursor | null, ahora: Date): Promise<void>;
  leerCursor(): Promise<Cursor | null>;
  registrarError(error: string, ahora: Date): Promise<void>;
  registrarIntento(ahora: Date): Promise<void>;
}

export interface DepsSync {
  repo: RepoCatalogo;
  /** GET crudo de la taxonomía al CRM. Tira ante error de red o status ≠ 200. */
  obtenerTaxonomia: () => Promise<unknown>;
  /** GET crudo de una página del delta. `null` = carga inicial. */
  obtenerOverlay: (cursor: Cursor | null) => Promise<unknown>;
  ahora: () => Date;
}

export interface ResultadoSync {
  ok: boolean;
  categorias: number;
  tags: number;
  items: number;
  paginas: number;
  error?: string;
}

export async function sincronizarCatalogo(deps: DepsSync, trigger: TriggerSync): Promise<ResultadoSync> {
  const ahora = deps.ahora();
  await deps.repo.registrarIntento(ahora);

  const resultado: ResultadoSync = { ok: true, categorias: 0, tags: 0, items: 0, paginas: 0 };

  // ── Taxonomía ──
  // Va primero: el overlay referencia categorías y tags por id, y aplicarlo antes dejaría
  // productos apuntando a categorías que la tienda todavía no conoce.
  try {
    const taxonomia = parsearTaxonomia(await deps.obtenerTaxonomia());
    await deps.repo.reemplazarTaxonomia(taxonomia, deps.ahora());
    resultado.categorias = taxonomia.categorias.length;
    resultado.tags = taxonomia.tags.length;
  } catch (err) {
    const msg = `taxonomía: ${err instanceof Error ? err.message : "error"}`;
    await deps.repo.registrarError(msg, deps.ahora());
    // Se corta acá: aplicar el overlay contra un árbol viejo es peor que no aplicarlo.
    return { ...resultado, ok: false, error: msg };
  }

  // ── Overlay, por delta ──
  try {
    let cursor = await deps.repo.leerCursor();
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const overlay = parsearOverlay(await deps.obtenerOverlay(cursor));

      // En la ÚLTIMA página el contrato manda `nextCursor: null`, pero eso no significa "volvé a
      // empezar": significa "no hay más por ahora". Guardar ese null borraría el punto de
      // reanudación y la próxima corrida se traería el catálogo entero de nuevo. Así que cuando
      // no viene cursor, se deriva del último item aplicado.
      const ultimo = overlay.items.at(-1);
      const cursorAGuardar =
        overlay.nextCursor ?? (ultimo ? { desde: ultimo.updatedAt, cursor: ultimo.alegraId } : cursor);

      // Va JUNTO con los items, en la misma transacción: separados, un corte en el medio podría
      // dejar el cursor adelantado y saltear una página para siempre.
      await deps.repo.aplicarPaginaOverlay(overlay.items, cursorAGuardar, deps.ahora());
      resultado.items += overlay.items.length;
      resultado.paginas++;

      if (!overlay.hasMore || !overlay.nextCursor) break;
      // Un `hasMore` con cursor que no avanza sería un bucle infinito contra el CRM.
      if (cursor && overlay.nextCursor.desde === cursor.desde && overlay.nextCursor.cursor === cursor.cursor) {
        throw new Error("el cursor no avanza");
      }
      cursor = overlay.nextCursor;
    }
  } catch (err) {
    const msg = `overlay: ${err instanceof Error ? err.message : "error"}`;
    await deps.repo.registrarError(msg, deps.ahora());
    // Las páginas ya aplicadas QUEDAN: el delta es incremental y la próxima corrida sigue desde
    // el cursor guardado. No hay estado a medias que limpiar.
    return { ...resultado, ok: false, error: msg };
  }

  void trigger;
  return resultado;
}
