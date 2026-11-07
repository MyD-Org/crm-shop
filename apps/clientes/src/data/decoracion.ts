/**
 * Decoración del sitio: apariencias opcionales que cada sitio (dominio) prende por su cuenta. Vive
 * en la fila `decoracion` de `home_content` (por sitio, ver `lib/home-guardar.ts`). Sin fila, o con
 * un payload que no sea exactamente `{ piedra: true }`, todo queda apagado: el aspecto de siempre.
 */
export const KEY_DECORACION = "decoracion";

export type Decoracion = {
  /** Textura de la piedra de Mar del Plata en la tienda (login, pie, 404, carrito vacío, "Visítenos"). */
  piedra: boolean;
};

export const DECORACION_POR_DEFECTO: Decoracion = { piedra: false };

function comoObjeto(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** Lo guardado, saneado: cualquier cosa que no sea `piedra: true` exacto es `false`. */
export function resolverDecoracion(raw: unknown): Decoracion {
  return { piedra: comoObjeto(raw)?.piedra === true };
}

/** Payload que llega del editor. */
export function validarDecoracion(
  payload: unknown,
): { ok: true; datos: Decoracion } | { ok: false; errores: string[] } {
  const o = comoObjeto(payload);
  if (!o || typeof o.piedra !== "boolean") {
    return { ok: false, errores: ["Indique si desea usar la textura de piedra en la tienda."] };
  }
  return { ok: true, datos: { piedra: o.piedra } };
}
