"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, Field, Input, useToast } from "@myd-org/ui";
import type { DatosLegales } from "@/data/home-defaults";
import { guardarDatosLegales } from "@/lib/home-acciones";

/**
 * Editor de los datos legales del comercio (fila `legal` de home_content).
 * Se abre desde la barra de edición de la home y desde cada página legal,
 * solo para admins. Sin "Mostrar en": estos datos no son una sección de la
 * home. El refresco lo hace `updateTag(TAG_HOME)` dentro de la acción.
 */
type Campo = keyof DatosLegales;

const CAMPOS: { campo: Campo; label: string; hint?: string; type?: string; inputMode?: "numeric" | "email" | "url" }[] = [
  { campo: "razonSocial", label: "Razón social" },
  { campo: "cuit", label: "CUIT", inputMode: "numeric" },
  { campo: "domicilio", label: "Domicilio" },
  { campo: "email", label: "Correo electrónico", type: "email", inputMode: "email" },
  {
    campo: "dataFiscalUrl",
    label: "Enlace del QR de Data Fiscal",
    hint: "Pegue el enlace que figura en el código que le entrega ARCA.",
    type: "url",
    inputMode: "url",
  },
];

export function DialogoDatosLegales({
  inicial,
  open,
  onOpenChange,
}: {
  inicial: DatosLegales;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [borrador, setBorrador] = useState<DatosLegales>(inicial);
  const [errores, setErrores] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // Reiniciar el borrador al abrir (ajuste de estado durante el render, como DialogoSeccion).
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setBorrador({ ...inicial });
      setErrores([]);
    }
  }

  function guardar() {
    startTransition(async () => {
      const r = await guardarDatosLegales(borrador);
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Datos legales guardados", tone: "success" });
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Datos legales"
      description="Se muestran en el pie de página y en las páginas legales. Deje vacío lo que no quiera mostrar."
      size="lg"
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
        {CAMPOS.map(({ campo, label, hint, type, inputMode }) => (
          <Field key={campo} label={label} hint={hint}>
            <Input
              type={type ?? "text"}
              inputMode={inputMode}
              value={borrador[campo] ?? ""}
              onChange={(e) => setBorrador((b) => ({ ...b, [campo]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
    </Dialog>
  );
}
