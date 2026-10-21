"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Switch } from "@myd-org/ui";
import { useModoEdicion } from "@/components/home/ModoEdicion";
import { useAlOcultar } from "@/lib/use-al-ocultar";
import { DialogoDatosMarca } from "./DialogoDatosMarca";

/**
 * Barra fija de edición de una página de marca (solo admins, la monta
 * `EdicionMarcaSiAdmin`): el mismo switch "Modo edición" que la home, los
 * datos generales de la página y el acceso a la lista de marcas.
 */
export function BarraEdicionMarca({ slug, publicada }: { slug: string; publicada: boolean }) {
  const { activo, setActivo } = useModoEdicion();
  const [abrirDatos, setAbrirDatos] = useState(false);
  useAlOcultar(() => setAbrirDatos(false));
  return (
    <div
      data-editor=""
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border bg-surface px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-text shadow-lg"
    >
      <Switch label="Modo edición" checked={activo} onCheckedChange={setActivo} />
      {publicada ? null : <Badge tone="warning">Página oculta</Badge>}
      <Button variant="outline" size="sm" onClick={() => setAbrirDatos(true)}>
        Datos de la página
      </Button>
      <Link href="/editar-marcas" className="text-sm font-medium text-accent underline-offset-4 hover:underline">
        Todas las marcas
      </Link>
      <DialogoDatosMarca slug={slug} open={abrirDatos} onOpenChange={setAbrirDatos} />
    </div>
  );
}
