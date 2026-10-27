"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Badge } from "@myd-org/ui";
import { infoPromoSku, promoClienteVigente, type DatosPromoCliente, type InfoPromoProducto } from "@/lib/promociones/promo";

/**
 * Promo de la home disponible en toda la tienda (cards y ficha). Lo monta el layout con
 * `datosPromoCliente`. La vigencia se calcula con el reloj del cliente: en el servidor y en la
 * hidratación no hay promo (snapshot null), así badges y bloque de ficha no generan mismatch.
 */
const PromoContext = createContext<DatosPromoCliente | null>(null);

export function PromoProvider({ datos, children }: { datos: DatosPromoCliente | null; children: ReactNode }) {
  return <PromoContext.Provider value={datos}>{children}</PromoContext.Provider>;
}

/** `setTimeout` admite hasta ~24,8 días; más allá se reprograma al vencer. */
const MAX_ESPERA_MS = 2 ** 31 - 1;

/**
 * Suscripción a la vigencia: UN timer hasta el próximo corte (inicio o fin), no un reloj por
 * segundo. Sin promo no programa nada: las cards de toda la tienda no se vuelven a dibujar.
 */
export function suscribirVigencia(datos: DatosPromoCliente | null) {
  return (aviso: () => void) => {
    if (!datos) return () => {};
    let t: ReturnType<typeof setTimeout> | undefined;
    const programar = () => {
      const ahora = Date.now();
      const cortes = [datos.inicio, datos.fin].map((iso) => (iso ? Date.parse(iso) : NaN)).filter((ms) => ms > ahora);
      if (cortes.length === 0) return;
      t = setTimeout(() => {
        aviso();
        programar();
      }, Math.min(Math.min(...cortes) - ahora, MAX_ESPERA_MS));
    };
    programar();
    return () => clearTimeout(t);
  };
}

/** Vigencia en el cliente; `false` en el servidor y en la hidratación (sin mismatch). */
function useVigente(datos: DatosPromoCliente | null): boolean {
  const suscribir = useMemo(() => suscribirVigencia(datos), [datos]);
  return useSyncExternalStore(
    suscribir,
    () => promoClienteVigente(datos, Date.now()),
    () => false,
  );
}

/** Para listas (una llamada por componente, no por card): sku → info de la promo o null. */
export function useInfoPromo(): (sku: string | undefined) => InfoPromoProducto | null {
  const datos = useContext(PromoContext);
  const vigente = useVigente(datos);
  return useCallback((sku) => (vigente ? infoPromoSku(datos, sku) : null), [datos, vigente]);
}

export function usePromoProducto(sku: string | undefined): InfoPromoProducto | null {
  return useInfoPromo()(sku);
}

/** Badge de promo de una card, o undefined (la card usa entonces su badge de siempre). */
export function badgePromo(info: InfoPromoProducto | null): ReactNode {
  return info ? <Badge tone="danger">{info.etiquetaBadge}</Badge> : undefined;
}
