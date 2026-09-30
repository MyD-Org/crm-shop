/**
 * Invitación proactiva del asesor (teaser del launcher, spec catálogo asistido
 * fase 2, §3): cuándo el Shop le ofrece ayuda al visitante sin que la pida.
 * Módulo puro: recibe la memoria de la sesión y el contexto, devuelve la
 * memoria nueva y, si corresponde, la invitación. Quién guarda la memoria y
 * publica el teaser es src/lib/iniciativa/motor.ts.
 *
 * Señales (solo concretas):
 * - `sin-resultados`: una búsqueda que no trajo nada (el rescate de la fase 1
 *   ya corrió: es lo que dibuja el "sin resultados" del catálogo).
 * - `busquedas`: `BUSQUEDAS_PARA_INVITAR` búsquedas distintas en la sesión sin
 *   agregar nada al carrito (agregar reinicia la cuenta).
 * - `ficha`: `MS_FICHA` en una ficha de producto sin agregar.
 *
 * Topes: una por sesión y como máximo una cada `DIAS_ENTRE_INVITACIONES` días.
 * Nunca con una búsqueda con forma de código (ni después de una: quien busca
 * por código sabe lo que quiere), con el chat abierto, en el checkout, o si el
 * visitante ya cerró una invitación en esta sesión. Nada de esto gasta tokens:
 * el turno con el asesor recién sale si el visitante acepta.
 */
import { pareceCodigo } from "../busqueda-inteligente/gate";
import { normalizarTexto } from "../catalogo-atributos";
import { MENSAJES_AL_CHAT, TEXTOS_TEASER } from "./textos";

export type Senal = "sin-resultados" | "busquedas" | "ficha";

export const BUSQUEDAS_PARA_INVITAR = 3;
export const MS_FICHA = 40_000;
export const DIAS_ENTRE_INVITACIONES = 3;
export const MS_ENTRE_INVITACIONES = DIAS_ENTRE_INVITACIONES * 24 * 60 * 60 * 1000;
/** Cuántas búsquedas se recuerdan (las últimas): alcanza para el mensaje. */
const MAX_RECORDADAS = 5;

/** Lo que se recuerda en la sesión (sessionStorage). */
export interface MemoriaSesion {
  /** Búsquedas distintas (texto tal cual) desde el último agregado al carrito. */
  busquedas: string[];
  /** La última búsqueda tenía forma de código. */
  ultimaEsCodigo: boolean;
  /** Ya se mostró una invitación en esta sesión. */
  mostrada: boolean;
  /** El visitante cerró una invitación en esta sesión. */
  descartada: boolean;
}

export const MEMORIA_INICIAL: MemoriaSesion = { busquedas: [], ultimaEsCodigo: false, mostrada: false, descartada: false };

export type EventoIniciativa =
  | { tipo: "busqueda"; consulta: string; sinResultados: boolean }
  | { tipo: "agregado" }
  | { tipo: "ficha-sin-agregar" };

export interface ContextoIniciativa {
  pathname: string;
  /** Hay un chat montado (bridge `disponible`). */
  disponible: boolean;
  chatAbierto: boolean;
  /** Epoch ms de la última invitación mostrada (localStorage), o null. */
  ultimaInvitacion: number | null;
  ahora: number;
}

/** Lo que el teaser necesita dibujar y lo que se envía si se acepta. */
export interface Invitacion {
  senal: Senal;
  text: string;
  actionLabel: string;
  dismissLabel: string;
  /** Primer mensaje al chat si el visitante acepta. */
  mensaje: string;
}

/** ¿El checkout (o una de sus pantallas)? Ahí nada interrumpe la compra. */
export function esCheckout(pathname: string): boolean {
  return /^\/checkout(\/|$|[?#])/.test(pathname);
}

/** Los topes y las condiciones que valen para cualquier señal. */
export function puedeInvitar(memoria: MemoriaSesion, contexto: ContextoIniciativa): boolean {
  if (!contexto.disponible || contexto.chatAbierto || esCheckout(contexto.pathname)) return false;
  if (memoria.mostrada || memoria.descartada || memoria.ultimaEsCodigo) return false;
  const { ultimaInvitacion, ahora } = contexto;
  // Una fecha en el futuro (reloj cambiado) no bloquea para siempre.
  if (ultimaInvitacion !== null && ultimaInvitacion <= ahora && ahora - ultimaInvitacion < MS_ENTRE_INVITACIONES) {
    return false;
  }
  return true;
}

const clave = (consulta: string) => normalizarTexto(consulta).replace(/\s+/g, " ").trim();

function invitacion(senal: Senal, mensaje: string): Invitacion {
  const text = senal === "sin-resultados" ? TEXTOS_TEASER.sinResultados : senal === "busquedas" ? TEXTOS_TEASER.busquedas : TEXTOS_TEASER.ficha;
  return { senal, text, actionLabel: TEXTOS_TEASER.aceptar, dismissLabel: TEXTOS_TEASER.cerrar, mensaje };
}

/**
 * Procesa un evento: la memoria siempre se actualiza (aunque no se pueda
 * invitar, las búsquedas cuentan); la invitación sale solo si la señal se
 * cumple y `puedeInvitar`. Mostrarla la marca en la memoria (una por sesión);
 * el tope de días lo escribe quien la publica.
 */
export function procesarEvento(
  memoria: MemoriaSesion,
  evento: EventoIniciativa,
  contexto: ContextoIniciativa,
): { memoria: MemoriaSesion; invitacion: Invitacion | null } {
  let siguiente = memoria;
  let candidata: Invitacion | null = null;

  if (evento.tipo === "agregado") {
    return { memoria: { ...memoria, busquedas: [] }, invitacion: null };
  }

  if (evento.tipo === "busqueda") {
    const consulta = evento.consulta.replace(/\s+/g, " ").trim();
    if (!consulta) return { memoria, invitacion: null };
    if (pareceCodigo(consulta)) return { memoria: { ...memoria, ultimaEsCodigo: true }, invitacion: null };
    const nueva = !memoria.busquedas.some((b) => clave(b) === clave(consulta));
    siguiente = {
      ...memoria,
      ultimaEsCodigo: false,
      busquedas: nueva ? [...memoria.busquedas, consulta].slice(-MAX_RECORDADAS) : memoria.busquedas,
    };
    if (evento.sinResultados) candidata = invitacion("sin-resultados", MENSAJES_AL_CHAT.sinResultados(consulta));
    else if (nueva && siguiente.busquedas.length >= BUSQUEDAS_PARA_INVITAR) {
      candidata = invitacion("busquedas", MENSAJES_AL_CHAT.busquedas(siguiente.busquedas.slice(-BUSQUEDAS_PARA_INVITAR)));
    }
  }

  if (evento.tipo === "ficha-sin-agregar") candidata = invitacion("ficha", MENSAJES_AL_CHAT.ficha);

  if (!candidata || !puedeInvitar(siguiente, contexto)) return { memoria: siguiente, invitacion: null };
  return { memoria: { ...siguiente, mostrada: true }, invitacion: candidata };
}

/** Lee la memoria guardada; cualquier cosa rara vuelve a la inicial. */
export function memoriaDe(crudo: string | null): MemoriaSesion {
  if (!crudo) return MEMORIA_INICIAL;
  try {
    const m = JSON.parse(crudo) as Partial<MemoriaSesion>;
    return {
      busquedas: Array.isArray(m.busquedas) ? m.busquedas.filter((b): b is string => typeof b === "string").slice(-MAX_RECORDADAS) : [],
      ultimaEsCodigo: m.ultimaEsCodigo === true,
      mostrada: m.mostrada === true,
      descartada: m.descartada === true,
    };
  } catch {
    return MEMORIA_INICIAL;
  }
}

/** Epoch ms guardado, o null si no hay o no es un número. */
export function fechaDe(crudo: string | null): number | null {
  if (!crudo) return null;
  const n = Number(crudo);
  return Number.isFinite(n) && n > 0 ? n : null;
}
