/**
 * `before_send` de PostHog: pasa por `limpiarUrl` todo valor que sea una URL
 * (`$current_url`, `$referrer`, `$initial_current_url`, los de `$set` y
 * `$set_once`…). Se recorre por forma y no por lista de claves para no depender
 * de qué propiedades agregue el SDK en una versión nueva.
 */
import { limpiarUrl } from "./url";

type Props = Record<string, unknown>;

const ES_URL = /^https?:\/\//i;

function limpiarProps(props: Props): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = typeof v === "string" && ES_URL.test(v) ? limpiarUrl(v) : v;
  }
  return out;
}

export function limpiarEventoPosthog<T extends { properties?: Props; $set?: Props; $set_once?: Props }>(
  evento: T | null,
): T | null {
  if (!evento) return evento;
  const copia = { ...evento };
  if (copia.properties) {
    copia.properties = limpiarProps(copia.properties);
    for (const k of ["$set", "$set_once"] as const) {
      const anidado = copia.properties[k];
      if (anidado && typeof anidado === "object") copia.properties[k] = limpiarProps(anidado as Props);
    }
  }
  if (copia.$set) copia.$set = limpiarProps(copia.$set);
  if (copia.$set_once) copia.$set_once = limpiarProps(copia.$set_once);
  return copia;
}
