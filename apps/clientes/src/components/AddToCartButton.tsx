"use client";

import { useState, type MouseEvent } from "react";
import { Button, QuantityStepper } from "@myd-org/ui";
import { CartIcon } from "@/components/catalogo/iconos";
import { useCart, type CartItem } from "@/context/CartContext";
import { CANTIDAD_MAXIMA } from "@/lib/catalogo-vista";
import { useHidratado } from "@/lib/hidratado";

interface AddToCartButtonProps {
  disabled?: boolean;
  /** Unidades disponibles: el stepper no deja pasar de acá. */
  max?: number;
  product?: Omit<CartItem, "qty">;
}

/**
 * Que un clic en el botón no llegue al `<Link>` que lo envuelve. En el
 * catálogo la card ya deja el botón fuera del enlace (stretched link del DS),
 * pero la home todavía envuelve la card entera en un `<Link>`: sin esto, el
 * "+" de la home navegaría a la ficha.
 */
function sinNavegar(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * "Agregar" a todo el ancho; con el producto en el carrito, el contador del DS
 * del mismo alto y el mismo fondo (nada salta al agregar). Con 1 unidad el "−"
 * es un tacho: ese toque lo saca del carrito.
 */
export function AddToCartButton({ disabled, max = CANTIDAD_MAXIMA, product }: AddToCartButtonProps) {
  const { items, addItem, removeItem, updateQty } = useCart();

  // Sin precio no hay venta posible: mismo criterio que el filtro de los
  // listados (`conPrecioSql`) y que la ficha de producto.
  const sinPrecio = product != null && !(product.price > 0);
  const deshabilitado = disabled || sinPrecio;

  // Sólo anima la aparición del stepper cuando la provoca un clic acá: si el
  // producto ya estaba en el carrito al cargar la página, aparece quieto.
  const [animarEntrada, setAnimarEntrada] = useState(false);

  // Mientras hidrata, "no está en el carrito" como en el servidor: en un hueco
  // que llega por streaming el carrito ya está cargado (ver useHidratado).
  const hidratado = useHidratado();
  const inCart = hidratado && product ? items.find((i) => i.id === product.id) : null;
  const qty = inCart?.qty ?? 0;

  if (!inCart || !product) {
    return (
      <Button
        variant="soft"
        className="w-full"
        aria-label="Agregar al carrito"
        disabled={deshabilitado}
        onClick={(e) => {
          sinNavegar(e);
          // Sin toast: el stepper que aparece acá y el latido del carrito del
          // header ya confirman la alta.
          if (!product) return;
          setAnimarEntrada(true);
          addItem(product);
        }}
      >
        <CartIcon />
        Agregar
      </Button>
    );
  }

  return (
    // El stepper no expone el evento del clic: se corta en el contenedor.
    // `inline-flex` al animar: `scale` no aplica sobre un inline común.
    <span
      onClick={sinNavegar}
      className={
        animarEntrada
          ? "flex w-full transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0"
          : "flex w-full"
      }
    >
      <QuantityStepper
        value={qty}
        min={0}
        // Sin stock o sin precio no se suma más, pero se puede bajar. Si ya
        // había más que las disponibles, tampoco se suma, pero se deja bajar.
        max={deshabilitado ? qty : Math.max(max, qty)}
        onValueChange={(n) => (n <= 0 ? removeItem(product.id) : updateQty(product.id, n))}
        decrementLabel="Quitar uno"
        incrementLabel="Agregar uno más"
        removeLabel="Quitar del carrito"
        tone="soft"
        size="md"
        fullWidth
      />
    </span>
  );
}
