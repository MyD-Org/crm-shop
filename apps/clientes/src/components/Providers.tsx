"use client";

import { ToastProvider } from "@myd-org/ui";
import { CartProvider } from "@/context/CartContext";
import { FavoritosProvider } from "@/context/FavoritosContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <CartProvider>
        {/* El bloqueo de favoritos (cookie del CRM sin Clerk) lo prende el hueco
            `BloqueoFavoritos` del layout: el shell no sabe quién mira. */}
        <FavoritosProvider>
          {children}
        </FavoritosProvider>
      </CartProvider>
    </ToastProvider>
  );
}
