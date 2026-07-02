"use client";

import { useCart, type CartItem } from "@/context/CartContext";
import { useToast } from "@myd-org/ui";

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

interface AddToCartButtonProps {
  disabled?: boolean;
  product?: Omit<CartItem, "qty">;
}

export function AddToCartButton({ disabled, product }: AddToCartButtonProps) {
  const { items, addItem, removeItem, updateQty } = useCart();
  const { toast } = useToast();

  const inCart = product ? items.find((i) => i.id === product.id) : null;
  const qty = inCart?.qty ?? 0;

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    if (!product) return;
    addItem(product);
    toast({
      title: "Agregado al carrito",
      description: `${product.name} · ${product.brand}`,
      tone: "success",
      action: { label: "Ver carrito", href: "/carrito" },
    });
  }

  function handleIncrease(e: React.MouseEvent) {
    e.preventDefault();
    if (product) updateQty(product.id, qty + 1);
  }

  function handleDecrease(e: React.MouseEvent) {
    e.preventDefault();
    if (!product) return;
    if (qty <= 1) removeItem(product.id);
    else updateQty(product.id, qty - 1);
  }

  if (!inCart) {
    return (
      <button
        disabled={disabled}
        onClick={handleAdd}
        aria-label="Agregar al carrito"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0a1f44] text-white transition-colors hover:bg-primary disabled:opacity-40"
      >
        <PlusIcon />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-xl bg-[#0a1f44] text-white">
      <button
        onClick={handleDecrease}
        aria-label="Quitar uno"
        className="flex h-10 w-9 items-center justify-center rounded-l-xl transition-colors hover:bg-primary"
      >
        <MinusIcon />
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold">{qty}</span>
      <button
        disabled={disabled}
        onClick={handleIncrease}
        aria-label="Agregar uno más"
        className="flex h-10 w-9 items-center justify-center rounded-r-xl transition-colors hover:bg-primary disabled:opacity-40"
      >
        <PlusIcon />
      </button>
    </div>
  );
}
