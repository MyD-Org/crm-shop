"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { CampaniaProducto, Product } from "@/data/products";
import {
  descuentoPropio,
  infoPromoSku,
  precioPrincipal,
  promoClienteVigente,
  type DatosPromoCliente,
  type InfoPromoProducto,
} from "@/lib/promociones/promo";

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

/**
 * Badge de promo de una card: la etiqueta ("Precio de apertura", navy como en la sección) y, si hay
 * rebaja real contra el precio habitual, el descuento en verde. Sin promo: undefined (la card usa su
 * badge de siempre). Sin tachado: la card muestra en grande el precio de lista y el habitual es el de
 * transferencia, mezclarlos confundiría.
 */
/**
 * Badge de una campaña de precios en las cards (spec 2026-10-28-campanias-precios-design.md): la
 * etiqueta (navy) y el % contra nuestro precio normal en verde, igual que `badgePromo`. Nunca el
 * `discount` del ProductCard, que lo pinta en rojo (el rojo es sólo para la urgencia).
 */
export function badgeCampania(c: CampaniaProducto): ReactNode {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-white">{c.etiqueta}</span>
      <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">{c.pct} % de descuento</span>
    </span>
  );
}

export function badgePromo(info: InfoPromoProducto | null, producto: Pick<Product, "price" | "precioFinal" | "precioMedio">): ReactNode {
  if (!info) return undefined;
  const d = descuentoPropio(precioPrincipal(producto).monto, info.habitual);
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-white">{info.etiquetaBadge}</span>
      {d ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">{d.pct} % de descuento</span> : null}
    </span>
  );
}
