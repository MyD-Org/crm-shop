"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { consultarOpcionesCuotas, type ConsultaCuotas } from "@/lib/checkout-cuotas-cliente";
import { binValido, crearConsultorCuotas, type ResultadoCuotas } from "./consultor-cuotas";

/**
 * Opciones de cuotas del formulario de pago de un pedido: se piden al montar (sin tarjeta, con los
 * planes de referencia) y de nuevo cada vez que cambia la tarjeta cargada: el BIN (Mercado Pago) o la
 * marca detectada o elegida (Payway). `recargar` vuelve a pedirlas (p. ej. tras un 409 al re-congelar el
 * pedido). Con `activo` en false no consulta nada.
 */
export function useOpcionesCuotas(pedidoId: string, tarjeta: ConsultaCuotas, activo: boolean) {
  const [resultado, setResultado] = useState<ResultadoCuotas & { cargando: boolean }>({
    datos: null,
    error: false,
    cargando: activo,
  });
  const consultor = useRef<ReturnType<typeof crearConsultorCuotas<ConsultaCuotas>> | null>(null);
  const binActual = binValido(tarjeta.bin);
  const marca = tarjeta.marca ?? null;
  const primera = useRef(true);

  useEffect(() => {
    const c = crearConsultorCuotas<ConsultaCuotas>({
      consultar: (t, signal) => consultarOpcionesCuotas(pedidoId, t, signal),
      alResultado: (r) => setResultado({ ...r, cargando: false }),
    });
    consultor.current = c;
    primera.current = true;
    return () => {
      c.cerrar();
      consultor.current = null;
    };
  }, [pedidoId]);

  useEffect(() => {
    if (!activo) return;
    // La primera consulta sale enseguida; las de cada tarjeta nueva, con la demora.
    consultor.current?.pedir({ bin: binActual, marca }, { inmediato: primera.current });
    primera.current = false;
  }, [binActual, marca, activo, pedidoId]);

  const recargar = useCallback(() => {
    consultor.current?.pedir({ bin: binActual, marca }, { inmediato: true });
  }, [binActual, marca]);

  return { ...resultado, recargar };
}
