"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCart, type CartItem } from "@/context/CartContext";

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

export function CartToast() {
  const { lastAdded } = useCart();
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<CartItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastAdded) return;
    setShown(lastAdded);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 3000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [lastAdded]);

  if (!shown) return null;

  return (
    <div
      className={`fixed bottom-6 right-6 z-[100] w-80 rounded-xl border border-border bg-surface shadow-lg transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold text-success">
        <CheckIcon />
        Agregado al carrito
      </div>
      <div className="flex items-center gap-3 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted/40">
          <LightbulbIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{shown.name}</p>
          <p className="text-xs text-muted">
            {shown.qty} u. · {shown.brand}
          </p>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Link
          href="/carrito"
          className="block w-full rounded-lg bg-[#0a1f44] py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-primary"
        >
          Ver carrito
        </Link>
      </div>
    </div>
  );
}
