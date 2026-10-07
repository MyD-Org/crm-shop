"use client";

import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/context/CartContext";
import { MetasCarrito } from "@/components/carrito/MetasCarrito";
import { lineasConProducto, metaCuotasFicha } from "@/lib/ficha-cuotas-carrito";
import type { MetaCarrito } from "@/lib/metas-carrito";
import type { ProgresoCuotas } from "@/lib/cuotas-sin-interes";

/** Misma espera que la cotización del carrito: quien toca + y − genera un solo pedido. */
const ESPERA_MS = 350;

interface Resultado {
  /** Producto y líneas que originaron la meta: una meta de otro producto no se muestra. */
  productoId: string;
  meta: MetaCarrito | null;
}

/**
 * Cuotas sin interés de la ficha "con su carrito": cotiza (sin tocar el carrito) lo que ya tiene más
 * este producto con la cantidad elegida y dice si la compra llega a cuotas sin interés o cuánto falta.
 * Todo del lado del navegador: la ficha pública y cacheada no sabe nada del carrito. Carrito vacío,
 * flag de cuotas apagado, cuenta corriente, lista privada o sin mínimos cargados: no dibuja nada
 * (el servidor no devuelve progreso). Mientras recotiza conserva la última meta, sin parpadeo.
 */
export function CuotasConCarrito({ productoId, qty }: { productoId: string; qty: number }) {
  const { items, ready } = useCart();
  const [res, setRes] = useState<Resultado | null>(null);

  // Sólo id y cantidad disparan el pedido: un cambio de nombre o de precio en el provider no recotiza.
  const clave = useMemo(() => {
    const lineas = lineasConProducto(
      items.map((i) => ({ id: i.id, qty: i.qty })),
      productoId,
      qty,
    );
    if (!lineas) return null;
    return JSON.stringify([...lineas].sort((a, b) => a.id.localeCompare(b.id)));
  }, [items, productoId, qty]);

  useEffect(() => {
    if (!ready || clave === null) return;
    const lineas = JSON.parse(clave) as { id: string; qty: number }[];
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/carrito/cotizar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({ items: lineas, entregaTipo: "retiro", progresoCuotas: true }),
        });
        if (!r.ok) {
          // 429 o error: es un dato accesorio, no se muestra nada ni se avisa.
          setRes({ productoId, meta: null });
          return;
        }
        const json = (await r.json()) as { progresoCuotas?: ProgresoCuotas };
        setRes({ productoId, meta: metaCuotasFicha(json.progresoCuotas) });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setRes({ productoId, meta: null });
      }
    }, ESPERA_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [clave, ready, productoId]);

  if (clave === null || res === null || res.productoId !== productoId || res.meta === null) return null;
  return (
    <div className="mt-3" data-testid="cuotas-con-carrito">
      <MetasCarrito metas={[res.meta]} compacta />
    </div>
  );
}
