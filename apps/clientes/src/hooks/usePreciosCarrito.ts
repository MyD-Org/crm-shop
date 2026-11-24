"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/context/CartContext";
import { useCotizacion } from "@/hooks/useCotizacion";
import { precioLineaCarrito, totalesEstimados } from "@/lib/carrito-precios";
import type { PagoTransferencia } from "@/lib/pago-transferencia-servidor";

/**
 * Precios con IVA de un resumen chico del carrito (popover del header, hoja mobile): los mismos
 * números que /carrito. El neto guardado en el carrito del navegador (`CartItem.price`) NO se
 * muestra nunca: un total armado con él queda ~21 % por debajo de la ficha.
 *
 * Cotiza con transferencia si la tienda la tiene (el precio más bajo, el que encabeza las cards) y,
 * aparte, con el precio general para «Con otros medios de pago». Cada cotización pega a Alegra:
 * sólo se cotiza con `activo` (resumen a la vista). Lo último cotizado queda mientras no cambie el
 * carrito, así el cierre animado no se vacía.
 */
export function usePreciosCarrito({
  activo = true,
  conProgresoCuotas = false,
}: { activo?: boolean; conProgresoCuotas?: boolean } = {}) {
  const { items } = useCart();
  // Con qué lista se cotiza la transferencia depende de quien mira: se pregunta al servidor, una
  // vez, recién la primera vez que el resumen se ve. `undefined` = todavía no se sabe; null = la
  // tienda no tiene precio con transferencia.
  const [pago, setPago] = useState<PagoTransferencia | null | undefined>(
    undefined,
  );
  const [pedido, setPedido] = useState(activo);
  if (activo && !pedido) setPedido(true);
  useEffect(() => {
    if (!pedido) return;
    const controller = new AbortController();
    fetch("/api/carrito/pago-transferencia", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { pago: null }))
      .then((d: { pago?: PagoTransferencia }) => setPago(d.pago ?? null))
      .catch(() => {
        if (!controller.signal.aborted) setPago(null);
      });
    return () => controller.abort();
  }, [pedido]);

  const { cotizacion, estado, ultimasLineas, ultimoProgresoCuotas } =
    useCotizacion({
      entregaTipo: "retiro",
      ...(conProgresoCuotas ? { conProgresoCuotas: true } : {}),
      activo: activo && pago !== undefined,
      ...(pago ?? {}),
    });
  // Total con los demás medios (precio general), sólo si hay precio con transferencia.
  const { cotizacion: cotizacionGeneral, estado: estadoGeneral } =
    useCotizacion({
      entregaTipo: "retiro",
      activo: activo && Boolean(pago),
    });

  const lineaVigente = (id: string) =>
    cotizacion?.lineas.find((l) => l.id === id);
  const lineaUltima = (id: string) => ultimasLineas?.find((l) => l.id === id);
  const total = cotizacion
    ? cotizacion.total
    : (totalesEstimados(items, ultimasLineas)?.total ?? null);
  const calculando = estado === "cargando" || pago === undefined;
  const totalOtrosMedios =
    pago &&
    estadoGeneral === "ok" &&
    cotizacionGeneral &&
    total !== null &&
    cotizacionGeneral.total > total
      ? cotizacionGeneral.total
      : null;

  return {
    /** Hay precio con transferencia: el total se rotula «Total con transferencia». */
    conTransferencia: Boolean(pago),
    /** Total con IVA (con transferencia si la hay); null mientras se calcula o si no se pudo. */
    total,
    calculando,
    totalOtrosMedios,
    conProblemas: !!cotizacion?.hayProblemas,
    ultimoProgresoCuotas,
    /** Precio con IVA de la línea; null mientras se calcula o si la línea tiene problema. */
    precioLinea: (id: string, qty: number) =>
      precioLineaCarrito(qty, lineaVigente(id), lineaUltima(id)),
    problemaLinea: (id: string) => lineaVigente(id)?.problema,
  };
}
