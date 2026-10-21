"use client";

import { useMemo } from "react";
import type { Product } from "@/data/products";
import type { VistaCatalogo } from "@/lib/catalogo-url";
import { CatalogoProductos } from "@/components/catalogo/CatalogoProductos";
import { usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { mejorCuotaProducto, type OpcionCuotas } from "@/lib/cuotas-sin-interes";
import { aplicarEstadoPrecio } from "@/lib/precios-cuenta-estado";

/**
 * La grilla del catálogo para una página de marca: mismas cards que
 * `/catalogo` (precio de la lista privada de la cuenta, cuotas, favoritos,
 * agregar al carrito), sin el panel de filtros.
 */
export function GrillaProductosMarca({ productos, vista = "grilla" }: { productos: Product[]; vista?: VistaCatalogo }) {
  const preciosCuenta = usePreciosCuenta(productos.map((p) => p.id));
  const conCuenta = useMemo(
    () => productos.map((p) => aplicarEstadoPrecio(p, preciosCuenta.get(p.id))),
    [productos, preciosCuenta],
  );
  const cuotasPorProducto = useMemo(() => {
    const m = new Map<string, OpcionCuotas>();
    for (const p of conCuenta) {
      const mejor = mejorCuotaProducto(p.cuotasSinInteres);
      if (mejor) m.set(p.id, mejor);
    }
    return m;
  }, [conCuenta]);
  return <CatalogoProductos productos={conCuenta} vista={vista} navegando={false} cuotasPorProducto={cuotasPorProducto} />;
}
