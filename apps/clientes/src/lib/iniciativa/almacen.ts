/**
 * Dónde se guardan los topes de la invitación proactiva (ver senales.ts):
 * - sessionStorage `MEMORIA`: búsquedas de la sesión, si ya se mostró o se
 *   cerró una invitación (una por sesión);
 * - localStorage `ULTIMA`: cuándo se mostró la última (una cada 3 días).
 *
 * Todo en try/catch: sin storage (servidor, navegación privada, cookies
 * bloqueadas, cuota llena) nada falla. Sin poder leer la fecha, se toma como
 * que no hubo invitación; sin poder guardar la memoria, vale la de este
 * módulo mientras dure la página (así igual hay una sola por sesión).
 */
import { MEMORIA_INICIAL, fechaDe, memoriaDe, type MemoriaSesion } from "./senales";

export const CLAVE_MEMORIA = "shop:iniciativa:sesion";
export const CLAVE_ULTIMA = "shop:iniciativa:ultima";

type Almacen = Pick<Storage, "getItem" | "setItem">;

function almacen(tipo: "sessionStorage" | "localStorage"): Almacen | null {
  try {
    return (globalThis as unknown as Record<string, Almacen | undefined>)[tipo] ?? null;
  } catch {
    return null;
  }
}

function leer(tipo: "sessionStorage" | "localStorage", clave: string): string | null {
  try {
    return almacen(tipo)?.getItem(clave) ?? null;
  } catch {
    return null;
  }
}

function escribir(tipo: "sessionStorage" | "localStorage", clave: string, valor: string): void {
  try {
    almacen(tipo)?.setItem(clave, valor);
  } catch {
    // Sin storage: queda la copia en memoria.
  }
}

/** Respaldo en memoria por si sessionStorage no anda. */
let enMemoria: MemoriaSesion | null = null;

export function leerMemoria(): MemoriaSesion {
  const crudo = leer("sessionStorage", CLAVE_MEMORIA);
  return crudo ? memoriaDe(crudo) : (enMemoria ?? MEMORIA_INICIAL);
}

export function guardarMemoria(memoria: MemoriaSesion): void {
  enMemoria = memoria;
  escribir("sessionStorage", CLAVE_MEMORIA, JSON.stringify(memoria));
}

export function leerUltimaInvitacion(): number | null {
  return fechaDe(leer("localStorage", CLAVE_ULTIMA));
}

/**
 * Cuenta una invitación para los topes: la sesión ya tuvo la suya (y, si se
 * cerró, no vuelve) y arranca la ventana de días.
 */
export function marcarTope({ descartada, ahora }: { descartada: boolean; ahora: number }): void {
  const memoria = leerMemoria();
  guardarMemoria({ ...memoria, mostrada: true, descartada: memoria.descartada || descartada });
  escribir("localStorage", CLAVE_ULTIMA, String(ahora));
}

/** Solo tests: olvida el respaldo en memoria. */
export function reiniciarAlmacen(): void {
  enMemoria = null;
}
