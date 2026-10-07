"use client";

import { Alert, Button } from "@myd-org/ui";
import { TEXTOS_LOCAL_RECORDADO } from "@/lib/busqueda-inteligente/textos";

/**
 * Aviso de que el catálogo llegó con "Con stock en <local>" puesto por el local recordado (cookie),
 * no por una elección de esta visita. "Ver todos los locales" hace lo mismo que quitar el chip:
 * saca el filtro y olvida la cookie (el padre pasa `quitar`). El chip sigue donde estaba.
 */
export function CatalogoAvisoLocal({ local, quitar }: { local: string; quitar: () => void }) {
  return (
    <div className="mt-3">
      <Alert tone="neutral" role="status">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{TEXTOS_LOCAL_RECORDADO.aviso(local)}</span>
          <Button variant="link" size="inline" onClick={quitar}>
            {TEXTOS_LOCAL_RECORDADO.accion}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
