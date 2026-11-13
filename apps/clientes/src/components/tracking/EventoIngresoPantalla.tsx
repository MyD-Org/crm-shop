"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/tracking/track";

/**
 * Mide que se vio la pantalla de ingreso o de registro (`ingreso_pantalla`). Lleva sólo el
 * pathname, nunca la query (Clerk la usa para tickets de sesión). Esas rutas no tienen tracking:
 * `track()` deja pasar este evento y lo manda sólo a PostHog.
 */
export function EventoIngresoPantalla() {
  const pathname = usePathname();
  useEffect(() => {
    track({ tipo: "ingreso_pantalla", ruta: pathname });
  }, [pathname]);
  return null;
}
