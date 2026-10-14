"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@myd-org/ui";
import type { PaginaParaEditor } from "@/lib/paginas-acciones";
import { DialogoPagina } from "./DialogoPagina";

/**
 * Lista de las páginas institucionales con su estado. Cada fila abre el
 * diálogo de edición. Mobile primero: las filas se apilan; en pantallas
 * anchas el botón queda a la derecha.
 */
export function EditorPaginas({ paginas }: { paginas: PaginaParaEditor[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-3">
      {paginas.map((p) => (
        <li
          key={p.slug}
          className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium text-text">{p.titulo}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={p.publicada ? "success" : "neutral"}>{p.publicada ? "Publicada" : "Oculta"}</Badge>
              <span className="text-sm text-muted">{p.personalizada ? "Texto propio" : "Texto base"}</span>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditando(p.slug)}>
            Editar
          </Button>
          <DialogoPagina
            pagina={p}
            open={editando === p.slug}
            onOpenChange={(abierto) => setEditando(abierto ? p.slug : null)}
            onGuardado={() => router.refresh()}
          />
        </li>
      ))}
    </ul>
  );
}
