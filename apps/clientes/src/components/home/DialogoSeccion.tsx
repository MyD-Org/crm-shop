"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, useToast } from "@myd-org/ui";
import type { SeccionHome } from "@/data/home-defaults";
import { guardarSeccion, restablecerSeccion } from "@/lib/home-acciones";
import { normalizarPayload, TITULOS_SECCION } from "@/lib/home-editor";
import { EDITORES } from "./editores";

/**
 * Dialog genérico por sección: monta el editor del registro `EDITORES`,
 * guarda con la server action `guardarSeccion` y ofrece "Restablecer valores
 * originales". El refresco visual lo hace `revalidatePath` dentro de la
 * action (D3): este componente NUNCA llama `router.refresh()`.
 */
export function DialogoSeccion({
  seccion,
  inicial,
  open,
  onOpenChange,
}: {
  seccion: SeccionHome;
  inicial: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [borrador, setBorrador] = useState<unknown>(inicial);
  const [errores, setErrores] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // Reiniciar el borrador cada vez que el Dialog pasa de cerrado a abierto
  // (patrón "ajustar estado según props" de React: durante el render, no en
  // un efecto, para no disparar un segundo render encadenado).
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setBorrador(structuredClone(inicial));
      setErrores([]);
    }
  }

  const Editor = EDITORES[seccion];

  function guardar() {
    startTransition(async () => {
      const r = await guardarSeccion(seccion, normalizarPayload(seccion, borrador));
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Sección guardada", tone: "success" });
      onOpenChange(false);
    });
  }

  function restablecer() {
    if (!window.confirm("¿Desea restablecer los valores originales de esta sección?")) return;
    startTransition(async () => {
      const r = await restablecerSeccion(seccion);
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Sección restablecida", tone: "success" });
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={TITULOS_SECCION[seccion]}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={restablecer} disabled={pending}>
            Restablecer valores originales
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" loading={pending} onClick={guardar}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errores.length > 0 ? (
          <Alert tone="danger" title="No se pudo guardar">
            <ul className="list-disc pl-5">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Editor valor={borrador} onChange={setBorrador} />
      </div>
    </Dialog>
  );
}
