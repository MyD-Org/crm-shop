"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 });

export function CartPreview() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { items, total, count } = useCart();

  function handleMouseEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function handleMouseLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger */}
      <Link
        href="/carrito"
        className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-text"
      >
        <div className="relative">
          <CartIcon />
          <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-info text-[10px] font-bold text-white">
            {count}
          </span>
        </div>
        <span className="font-semibold text-text">{fmt(total)}</span>
      </Link>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-3 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Puntero */}
          <div className="absolute -top-[7px] right-6 h-3 w-3 rotate-45 border-l border-t border-border bg-surface" />

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-sm font-medium text-text">Tu carrito esta vacio</p>
              <Link href="/catalogo" className="text-xs font-semibold text-primary hover:underline">
                Ver catalogo
              </Link>
            </div>
          ) : (
            <>
              <div className="p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  Carrito ({count} productos)
                </p>

                <ul className="max-h-72 space-y-3 overflow-y-auto">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/producto/${item.id}`}
                        className="flex items-center gap-3 rounded-lg p-1 -mx-1 transition-colors hover:bg-elevated"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted/40">
                          <LightbulbIcon />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-text">{item.name}</p>
                          <p className="text-xs text-muted">{item.qty} u. · {fmt(item.price)} c/u</p>
                        </div>
                        <p className="shrink-0 text-xs font-bold text-text">{fmt(item.price * item.qty)}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-border px-4 py-3">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-muted">Total</span>
                  <span className="font-extrabold text-text">{fmt(total)}</span>
                </div>
                <Link href="/carrito" className="block">
                  <Button className="w-full">Ver carrito</Button>
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
