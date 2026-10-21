"use client";

import type { ReactNode } from "react";
import type { Visibilidad } from "@/data/home-defaults";
import { ComoVisitante } from "@/components/home/SeccionEditable";
import type { BloqueMarca } from "@/lib/marcas/pagina-marca";

/**
 * Envuelve un bloque de una página de marca. Para un visitante solo aplica la
 * visibilidad (siempre / desktop / mobile / nunca), igual que la home.
 */
export function BloqueMarcaEditable({
  visibilidad,
  children,
}: {
  slug: string;
  bloque: BloqueMarca;
  visibilidad: Visibilidad;
  children: ReactNode;
}) {
  return <ComoVisitante visibilidad={visibilidad}>{children}</ComoVisitante>;
}
