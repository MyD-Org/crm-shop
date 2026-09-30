/**
 * Motor de la invitación proactiva: junta las reglas puras (senales.ts), los
 * topes guardados (almacen.ts) y el puente con el chat (chat-ia-puente.ts).
 * Las páginas le avisan lo que pasó (`anotarBusqueda` desde el catálogo; el
 * hook `useSenalesIniciativa` avisa los agregados al carrito y los 40 s en la
 * ficha) y, si una señal se cumple, el motor propone el teaser.
 *
 * Sin chat montado no hace nada (ni siquiera cuenta búsquedas): el visitante
 * que no tiene asesor no deja rastro en el storage.
 */
import { chatIaAbierto, estadoChatIa, proponerTeaser } from "../chat-ia-puente";
import { guardarMemoria, leerMemoria, leerUltimaInvitacion, marcarTope } from "./almacen";
import { procesarEvento, type EventoIniciativa } from "./senales";

function rutaActual(): string {
  try {
    return globalThis.location?.pathname ?? "/";
  } catch {
    return "/";
  }
}

/** Procesa un evento; `true` si terminó en una invitación a la vista. */
export function anotarEvento(evento: EventoIniciativa, ahora = Date.now()): boolean {
  const { disponible } = estadoChatIa();
  if (!disponible) return false;
  const previa = leerMemoria();
  const { memoria, invitacion } = procesarEvento(previa, evento, {
    pathname: rutaActual(),
    disponible,
    chatAbierto: chatIaAbierto(),
    ultimaInvitacion: leerUltimaInvitacion(),
    ahora,
  });
  if (!invitacion) {
    guardarMemoria(memoria);
    return false;
  }
  const publicado = proponerTeaser(invitacion);
  // Si no se pudo mostrar (ya había otra a la vista) no cuenta para el tope.
  guardarMemoria(publicado ? memoria : { ...memoria, mostrada: previa.mostrada });
  if (publicado) marcarTope({ descartada: false, ahora });
  return publicado !== null;
}

/**
 * El catálogo terminó de mostrar una búsqueda (con o sin resultados).
 * `conInvitacionEnLinea`: el sin resultados ya muestra "Conversar" (ver
 * senales.ts).
 */
export function anotarBusqueda(consulta: string, sinResultados: boolean, conInvitacionEnLinea = false): boolean {
  return anotarEvento({ tipo: "busqueda", consulta, sinResultados, conInvitacionEnLinea });
}
