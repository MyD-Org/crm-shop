"use client";

import { ToggleIconButton } from "@myd-org/ui";
import { IconoCorazon } from "@/components/mi-cuenta/iconos";
import { useFavoritos } from "@/context/FavoritosContext";

/**
 * Corazón de favoritos (catálogo, home, ficha y Mi cuenta).
 *
 * - Cookie del CRM sin Clerk: no se renderiza (no hay dónde guardar).
 * - Antes de `ready`: neutro y `aria-disabled` (mismo HTML en el server y en el
 *   primer render del cliente).
 * - Anónimo: al tocarlo se abre el ingreso de Clerk (lo resuelve el provider).
 * - `dentroDeLink`: la card de la home sigue envuelta en un `<Link>`; el clic no
 *   tiene que navegar a la ficha.
 */
export function BotonFavorito({
  productId,
  dentroDeLink = false,
  size = "md",
}: {
  productId: string;
  dentroDeLink?: boolean;
  size?: "sm" | "md";
}) {
  const { ready, disponible, esFavorito, toggle } = useFavoritos();
  if (!disponible) return null;

  const pressed = ready && esFavorito(productId);
  return (
    <ToggleIconButton
      pressed={pressed}
      tone="danger"
      size={size}
      aria-disabled={!ready || undefined}
      aria-label={pressed ? "Quitar de favoritos" : "Guardar en favoritos"}
      icon={<IconoCorazon relleno={pressed} />}
      onClick={(e) => {
        if (dentroDeLink) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onPressedChange={() => void toggle(productId)}
    />
  );
}
