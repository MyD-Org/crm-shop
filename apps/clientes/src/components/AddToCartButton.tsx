"use client";

import type { MouseEvent } from "react";
import { Button, QuantityStepper } from "@myd-org/ui";
import { PlusIcon } from "@/components/catalogo/iconos";
import { useCart, type CartItem } from "@/context/CartContext";

interface AddToCartButtonProps {
  disabled?: boolean;
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

/** "+" redondo para agregar; con el producto en el carrito, el stepper del DS. */
export function AddToCartButton({ disabled, product }: AddToCartButtonProps) {
  const { items, addItem, removeItem, updateQty } = useCart();

  // Sin precio no hay venta posible: mismo criterio que el filtro de los
  // listados (`conPrecioSql`) y que la ficha de producto.
  const sinPrecio = product != null && !(product.price > 0);
  const deshabilitado = disabled || sinPrecio;

  const inCart = product ? items.find((i) => i.id === product.id) : null;
  const qty = inCart?.qty ?? 0;

  if (!inCart || !product) {
    return (
      <Button
        variant="primary"
        size="icon-lg"
        shape="round"
        aria-label="Agregar al carrito"
        disabled={deshabilitado}
        onClick={(e) => {
          sinNavegar(e);
          // Sin toast: el preview del header se abre solo y muestra lo que entró.
          if (product) addItem(product);
        }}
      >
        <PlusIcon />
      </Button>
    );
  }

  return (
    // El stepper no expone el evento del clic: se corta en el contenedor.
    <span onClick={sinNavegar}>
      <QuantityStepper
        value={qty}
        min={0}
        // Sin stock o sin precio no se suma más, pero se puede bajar.
        max={deshabilitado ? qty : 999}
        onValueChange={(n) => (n <= 0 ? removeItem(product.id) : updateQty(product.id, n))}
        decrementLabel="Quitar uno"
        incrementLabel="Agregar uno más"
      />
    </span>
  );
}
