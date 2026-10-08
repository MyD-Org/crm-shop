/**
 * Quién pide las opciones de cuotas del formulario de pago y cuándo (lo usa `useOpcionesCuotas`; fuera
 * de React para poder testearlo sin DOM): al montar enseguida y, en cada cambio del BIN de la tarjeta,
 * con una demora corta para no consultar por cada dígito. Una consulta nueva aborta la anterior: nunca
 * se pisa una respuesta nueva con una vieja.
 */
import type { OpcionesCuotasPedido } from "@/lib/checkout-cuotas-cliente";

export const DEMORA_BIN_MS = 250;

export interface ResultadoCuotas {
  datos: OpcionesCuotasPedido | null;
  /** No se pudo consultar: el formulario ofrece lo que el pedido ya tiene congelado. */
  error: boolean;
}

/** El BIN que manda el Brick (6 u 8 dígitos); vacío o incompleto = sin tarjeta. */
export function binValido(bin: string | null | undefined): string | null {
  return typeof bin === "string" && /^\d{6,8}$/.test(bin) ? bin : null;
}

export function crearConsultorCuotas(a: {
  consultar: (bin: string | null, signal: AbortSignal) => Promise<OpcionesCuotasPedido | null>;
  alResultado: (r: ResultadoCuotas) => void;
  demoraMs?: number;
}) {
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let enVuelo: AbortController | null = null;

  const cancelar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    enVuelo?.abort();
    enVuelo = null;
  };

  const lanzar = async (bin: string | null) => {
    temporizador = null;
    const control = new AbortController();
    enVuelo = control;
    let r: ResultadoCuotas;
    try {
      const datos = await a.consultar(bin, control.signal);
      r = { datos, error: datos === null };
    } catch {
      r = { datos: null, error: true };
    }
    if (control.signal.aborted) return;
    enVuelo = null;
    a.alResultado(r);
  };

  return {
    pedir(bin: string | null, opciones?: { inmediato?: boolean }) {
      cancelar();
      temporizador = setTimeout(() => void lanzar(bin), opciones?.inmediato ? 0 : (a.demoraMs ?? DEMORA_BIN_MS));
    },
    cerrar: cancelar,
  };
}
