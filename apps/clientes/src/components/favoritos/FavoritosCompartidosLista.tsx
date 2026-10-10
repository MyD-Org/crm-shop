"use client";

import { useState } from "react";
import { Button, useToast } from "@myd-org/ui";
import { ProductoFavCard } from "@/components/favoritos/ProductoFavCard";
import { useCart } from "@/context/CartContext";
import { useFavoritos } from "@/context/FavoritosContext";
import type { Product } from "@/data/products";
import { usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { useHidratado } from "@/lib/hidratado";
import { aplicarEstadoPrecio } from "@/lib/precios-cuenta-estado";

/**
 * Lista de favoritos que le compartieron: de SOLO lectura. Muestra todo lo que
 * llegó del servidor (no usa `visiblesEnLista`: un visitante anónimo, con
 * favoritos vacíos, la dejaría sin cards). Cada card tiene su corazón y su
 * "Agregar"; arriba, "Agregar todos al carrito" y "Agregar todos a mis
 * favoritos". Abrir la página no modifica nada: todo es a pedido.
 */
export function FavoritosCompartidosLista({
  productos,
  noDisponibles,
}: {
  productos: Product[];
  noDisponibles: number;
}) {
  const { addItems } = useCart();
  const favoritos = useFavoritos();
  const { disponible, esFavorito, agregarTodos } = favoritos;
  // Mismo motivo que en CargarCompartido: hueco por streaming, el contexto ya
  // está listo al hidratar y el `disabled` del servidor no se corregiría.
  const ready = useHidratado() && favoritos.ready;
  const { toast } = useToast();
  const [agregando, setAgregando] = useState(false);
  const preciosCuenta = usePreciosCuenta(productos.map((p) => p.id));
  const visibles = productos.map((p) => aplicarEstadoPrecio(p, preciosCuenta.get(p.id)));

  const todosSonFavoritos = ready && productos.every((p) => esFavorito(p.id));

  function agregarAlCarrito() {
    const conPrecio = visibles.filter((p) => p.price > 0 && p.stock !== "out");
    const omitidos = visibles.length - conPrecio.length;
    if (conPrecio.length === 0) {
      toast({ title: "Ninguno de los productos se puede agregar al carrito en este momento.", tone: "danger" });
      return;
    }
    addItems(
      conPrecio.map((p) => ({
        item: { id: p.id, name: p.name, brand: p.brand, price: p.price, image: p.images?.[0]?.url },
        qty: 1,
      })),
    );
    toast({
      title:
        conPrecio.length === 1
          ? "Se agregó 1 producto a su carrito."
          : `Se agregaron ${conPrecio.length} productos a su carrito.`,
      description:
        omitidos > 0
          ? omitidos === 1
            ? "1 producto no se pudo agregar: no tiene precio o stock."
            : `${omitidos} productos no se pudieron agregar: no tienen precio o stock.`
          : undefined,
      tone: "success",
    });
  }

  async function agregarAFavoritos() {
    if (agregando) return;
    setAgregando(true);
    try {
      await agregarTodos(productos.map((p) => p.id));
    } finally {
      setAgregando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {noDisponibles > 0 && (
        <p className="text-sm text-muted" role="status">
          {noDisponibles === 1
            ? "1 producto de esta lista ya no está disponible."
            : `${noDisponibles} productos de esta lista ya no están disponibles.`}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" size="sm" onClick={agregarAlCarrito}>
          Agregar todos al carrito
        </Button>
        {disponible && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!ready || agregando || todosSonFavoritos}
            onClick={() => void agregarAFavoritos()}
          >
            {agregando
              ? "Agregando…"
              : todosSonFavoritos
                ? "Ya están en sus favoritos"
                : "Agregar todos a mis favoritos"}
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {visibles.map((p) => (
          <ProductoFavCard key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}
