"use client";

import { Button, Switch } from "@myd-org/ui";
import type { HomeContent, NavBadgeContent } from "@/data/home-defaults";
import { useModoEdicion } from "./ModoEdicion";

/**
 * Barra fija de modo edición, solo se monta si `puedeEditar` (ver
 * `src/app/page.tsx`). En esta rebanada (A) los accesos "Anuncio" y "Badge
 * del menú" están deshabilitados: se enchufan en B1 con sus editores.
 */
export function BarraEdicion({
  anuncio,
  navBadge,
}: {
  anuncio: HomeContent["anuncio"];
  navBadge: NavBadgeContent | null;
}) {
  const { activo, setActivo } = useModoEdicion();
  // Se van a usar en B1 al abrir el Dialog de cada acceso.
  void anuncio;
  void navBadge;

  return (
    <div
      data-editor=""
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-4 border-t border-border bg-surface px-4 py-2 shadow-lg"
    >
      <Switch label="Modo edición" checked={activo} onCheckedChange={setActivo} />
      <Button variant="outline" size="sm" disabled title="Disponible en la próxima versión">
        Anuncio
      </Button>
      <Button variant="outline" size="sm" disabled title="Disponible en la próxima versión">
        Badge del menú
      </Button>
    </div>
  );
}
