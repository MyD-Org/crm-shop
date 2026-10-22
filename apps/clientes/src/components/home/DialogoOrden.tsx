"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, useToast } from "@myd-org/ui";
import { moverEnOrden } from "@/lib/orden-secciones";

type Resultado = { ok: true } | { ok: true; updatedAt: string | null } | { ok: false; errores: string[] };

/**
 * "Ordenar secciones" (home y páginas de marca): la lista de secciones con flechas para subir o
 * bajar cada una. El cambio se guarda recién con "Guardar"; la acción revalida la página, así que
 * este componente no refresca nada por su cuenta.
 */
export function DialogoOrden<T extends string>({
  items,
  open,
  onOpenChange,
  onGuardar,
}: {
  /** En el orden vigente. */
  items: { id: T; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGuardar: (orden: T[]) => Promise<Resultado>;
}) {
  const [orden, setOrden] = useState<T[]>(items.map((i) => i.id));
  const [errores, setErrores] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // Al abrir, arranca del orden vigente (ajuste de estado durante el render, como DialogoSeccion).
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setOrden(items.map((i) => i.id));
      setErrores([]);
    }
  }

  const etiqueta = new Map(items.map((i) => [i.id, i.label]));

  function guardar() {
    startTransition(async () => {
      const r = await onGuardar(orden);
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Orden guardado", tone: "success" });
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ordenar secciones"
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" loading={pending} onClick={guardar}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Suba o baje cada sección. Las secciones ocultas también figuran: conservan su lugar para cuando las muestre.
        </p>
        {errores.length > 0 ? (
          <Alert tone="danger" title="No se pudo guardar">
            <ul className="list-disc pl-5">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <ol className="flex flex-col gap-2">
          {orden.map((id, i) => (
            <li key={id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <span className="w-6 text-sm tabular-nums text-muted">{i + 1}</span>
              <span className="flex-1 text-sm font-medium text-text">{etiqueta.get(id) ?? id}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || i === 0}
                aria-label={`Subir ${etiqueta.get(id) ?? id}`}
                onClick={() => setOrden((o) => moverEnOrden(o, id, "arriba"))}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || i === orden.length - 1}
                aria-label={`Bajar ${etiqueta.get(id) ?? id}`}
                onClick={() => setOrden((o) => moverEnOrden(o, id, "abajo"))}
              >
                ↓
              </Button>
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  );
}
