"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { Badge } from "@myd-org/ui";
import { infoPromoDe, type DatosPromoCliente, type InfoPromoProducto } from "@/lib/promociones/promo";
import { useAhora } from "./reloj";

/**
 * Promo de la home disponible en toda la tienda (cards y ficha). Lo monta el layout con
 * `datosPromoCliente`. La vigencia se calcula con el reloj del cliente: en el servidor y en la
 * hidratación no hay promo (snapshot null), así badges y bloque de ficha no generan mismatch.
 */
const PromoContext = createContext<DatosPromoCliente | null>(null);

export function PromoProvider({ datos, children }: { datos: DatosPromoCliente | null; children: ReactNode }) {
  return <PromoContext.Provider value={datos}>{children}</PromoContext.Provider>;
}

/** Para listas (una llamada por componente, no por card): sku → info de la promo o null. */
export function useInfoPromo(): (sku: string | undefined) => InfoPromoProducto | null {
  const datos = useContext(PromoContext);
  const ahora = useAhora();
  return useCallback((sku) => (ahora === null ? null : infoPromoDe(datos, sku, ahora)), [datos, ahora]);
}

export function usePromoProducto(sku: string | undefined): InfoPromoProducto | null {
  return useInfoPromo()(sku);
}

/** Badge de promo de una card, o undefined (la card usa entonces su badge de siempre). */
export function badgePromo(info: InfoPromoProducto | null): ReactNode {
  return info ? <Badge tone="danger">{info.etiquetaBadge}</Badge> : undefined;
}
