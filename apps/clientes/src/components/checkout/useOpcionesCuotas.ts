"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { consultarOpcionesCuotas } from "@/lib/checkout-cuotas-cliente";
import { binValido, crearConsultorCuotas, type ResultadoCuotas } from "./consultor-cuotas";

/**
 * Opciones de cuotas del formulario de pago de un pedido: se piden al montar (sin tarjeta, con los
 * planes de referencia) y de nuevo cada vez que cambia el BIN de la tarjeta cargada. `recargar` vuelve a
 * pedirlas (p. ej. tras un 409 al re-congelar el pedido). Con `activo` en false no consulta nada.
 */
export function useOpcionesCuotas(pedidoId: string, bin: string | null, activo: boolean) {
  const [resultado, setResultado] = useState<ResultadoCuotas & { cargando: boolean }>({
    datos: null,
    error: false,
    cargando: activo,
  });
  const consultor = useRef<ReturnType<typeof crearConsultorCuotas> | null>(null);
  const binActual = binValido(bin);
  const primera = useRef(true);

  useEffect(() => {
    const c = crearConsultorCuotas({
      consultar: (b, signal) => consultarOpcionesCuotas(pedidoId, b, signal),
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
    // La primera consulta sale enseguida; las de cada BIN nuevo, con la demora.
    consultor.current?.pedir(binActual, { inmediato: primera.current });
    primera.current = false;
  }, [binActual, activo, pedidoId]);

  const recargar = useCallback(() => {
    consultor.current?.pedir(binActual, { inmediato: true });
  }, [binActual]);

  return { ...resultado, recargar };
}
