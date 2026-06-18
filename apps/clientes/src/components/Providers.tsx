"use client";

import { CartProvider } from "@/context/CartContext";
import { CartToast } from "./CartToast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      {children}
      <CartToast />
    </CartProvider>
  );
}
