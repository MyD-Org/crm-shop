"use client";

import { useEffect, useRef, useState } from "react";
import {
  MENSAJE_SIN_COBRO,
  VENTANA_SONDEO_MS,
  consultarPagoDelPedido,
  esperaSondeo,
  type ResultadoSondeo,
} from "@/lib/pagos/sondeo-pago";

/**
 * Consulta el estado del pago de un pedido cada pocos segundos (con espaciado creciente) durante unos
 * minutos, hasta que el procesador lo resuelve. Lo comparten el checkout ("Estamos confirmando su
 * pago") y el detalle del pedido en Mi cuenta.
 *
 * `onResuelto` se llama UNA vez, con `pagado` o `rechazado`. Si se agota la ventana (o no hay nada que
 * seguir consultando) `agotado` pasa a true; `reiniciar()` vuelve a empezar.
 *
 * `inmediato`: la primera consulta sale ya (el detalle), no tras la primera espera (el checkout, donde
 * el cobro recién se envió).
 */
export function useSondeoPago(
  pedidoId: string,
  onResuelto: (r: Extract<ResultadoSondeo, { fase: "pagado" | "rechazado" }>) => void,
  {
    inmediato = false,
    pagoMercadoPagoId,
  }: { inmediato?: boolean; pagoMercadoPagoId?: string } = {},
) {
  const [agotado, setAgotado] = useState(false);
  // Cada vez que cambia, arranca una espera nueva.
  const [ronda, setRonda] = useState(0);

  // El aviso va por ref: es una función nueva en cada render y no debe reiniciar el sondeo.
  const aviso = useRef(onResuelto);
  useEffect(() => {
    aviso.current = onResuelto;
  });

  useEffect(() => {
    let vigente = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inicio = Date.now();

    let sinCobroSeguidas = 0;
    async function sondear(n: number) {
      const r = await consultarPagoDelPedido(pedidoId, fetch, pagoMercadoPagoId);
      if (!vigente) return;
      if (r.fase === "pagado" || r.fase === "rechazado") return aviso.current(r);
      // Dos veces seguidas sin ningún cobro en curso: el envío nunca llegó. No hay nada que esperar.
      sinCobroSeguidas = r.fase === "sinCobro" ? sinCobroSeguidas + 1 : 0;
      if (sinCobroSeguidas >= 2) return aviso.current({ fase: "rechazado", mensaje: MENSAJE_SIN_COBRO, cobrable: true });
      const espera = esperaSondeo(n + 1);
      if (r.fase === "perdido" || Date.now() - inicio + espera > VENTANA_SONDEO_MS) {
        setAgotado(true);
        return;
      }
      timer = setTimeout(() => void sondear(n + 1), espera);
    }

    timer = setTimeout(() => void sondear(0), inmediato ? 0 : esperaSondeo(0));
    return () => {
      vigente = false;
      if (timer) clearTimeout(timer);
    };
  }, [pedidoId, ronda, inmediato, pagoMercadoPagoId]);

  return {
    agotado,
    reiniciar: () => {
      setAgotado(false);
      setRonda((n) => n + 1);
    },
  };
}
