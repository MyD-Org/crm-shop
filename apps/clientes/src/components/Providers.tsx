"use client";

import { ToastProvider } from "@myd-org/ui";
import { CartProvider } from "@/context/CartContext";
import { FavoritosProvider } from "@/context/FavoritosContext";

export function Providers({
  favoritosBloqueados,
  children,
}: {
  /** Cookie del CRM sin Clerk: sin corazón de favoritos (ver src/app/layout.tsx). */
  favoritosBloqueados: boolean;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <CartProvider>
        <FavoritosProvider favoritosBloqueados={favoritosBloqueados}>
          {children}
        </FavoritosProvider>
      </CartProvider>
    </ToastProvider>
  );
}
