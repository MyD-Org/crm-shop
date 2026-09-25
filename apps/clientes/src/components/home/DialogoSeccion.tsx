"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Alert, Button, Dialog, SegmentedControl, Spinner, useToast } from "@myd-org/ui";
import type { SeccionHome, Visibilidad } from "@/data/home-defaults";
import {
  cambiarVisibilidadSeccion,
  guardarSeccion,
  leerSeccionParaEditar,
  restablecerSeccion,
} from "@/lib/home-acciones";
import { normalizarPayload, TITULOS_SECCION } from "@/lib/home-editor";
import { EDITORES } from "./editores";
import { OPCIONES_VISIBILIDAD } from "./editores/SelectorVisibilidad";

/**
 * Dialog genérico por sección: al abrirse pide los datos de la sección con
 * `leerSeccionParaEditar` (la home no los manda en su payload), monta el
 * editor del registro `EDITORES`, guarda con la server action `guardarSeccion`
 * y ofrece "Restablecer valores originales". El refresco visual lo hace la
 * revalidación de la home dentro de cada action (hoy `revalidatePath`): este
 * componente NUNCA llama `router.refresh()`.
 *
 * "Mostrar en" (siempre / desktop / mobile / nunca) se aplica al instante,
 * aparte del borrador: no guarda los cambios de contenido sin guardar.
 */
const AVISO_VISIBILIDAD: Record<Visibilidad, string | null> = {
  siempre: null,
  desktop: "En celulares esta sección no se muestra.",
  mobile: "En computadoras esta sección no se muestra.",
  nunca: "Los visitantes de la tienda no ven esta sección. Puede editarla igual y mostrarla cuando quiera.",
};
const TOAST_VISIBILIDAD: Record<Visibilidad, string> = {
  siempre: "La sección se muestra siempre",
  desktop: "La sección se muestra solo en desktop",
  mobile: "La sección se muestra solo en mobile",
  nunca: "Sección oculta en la tienda",
};
const ERROR_CARGA = "No se pudo cargar la sección. Inténtelo de nuevo.";

type Carga = { estado: "cargando" } | { estado: "lista" } | { estado: "error"; mensaje: string };

export function DialogoSeccion({
  seccion,
  visibilidad,
  open,
  onOpenChange,
}: {
  seccion: SeccionHome;
  visibilidad: Visibilidad;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [borrador, setBorrador] = useState<unknown>(undefined);
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [intento, setIntento] = useState(0);
  const [errores, setErrores] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  // El selector cambia al toque; la prop real llega cuando revalida la home.
  const [visibilidadVista, setVisibilidadVista] = useOptimistic(visibilidad);

  // Reiniciar el borrador cada vez que el Dialog pasa de cerrado a abierto
  // (patrón "ajustar estado según props" de React: durante el render, no en
  // un efecto, para no disparar un segundo render encadenado).
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setBorrador(undefined);
      setCarga({ estado: "cargando" });
      setErrores([]);
    }
  }

  // Datos de la sección, pedidos al abrir (y en cada "Reintentar"). Siempre
  // frescos: lo último guardado, aunque la home todavía no se haya refrescado.
  useEffect(() => {
    if (!open) return;
    let vigente = true;
    leerSeccionParaEditar(seccion).then(
      (r) => {
        if (!vigente) return;
        if (r.ok) {
          setBorrador(r.valor);
          setCarga({ estado: "lista" });
        } else {
          setCarga({ estado: "error", mensaje: r.error });
        }
      },
      () => {
        if (vigente) setCarga({ estado: "error", mensaje: ERROR_CARGA });
      },
    );
    return () => {
      vigente = false;
    };
  }, [open, seccion, intento]);

  function reintentar() {
    setCarga({ estado: "cargando" });
    setIntento((n) => n + 1);
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

  function cambiarVisibilidad(nueva: Visibilidad) {
    if (nueva === visibilidadVista) return;
    startTransition(async () => {
      setVisibilidadVista(nueva);
      const r = await cambiarVisibilidadSeccion(seccion, nueva);
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: TOAST_VISIBILIDAD[nueva], tone: "success" });
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
          <Button type="button" loading={pending} disabled={carga.estado !== "lista"} onClick={guardar}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-text">Mostrar en</span>
          <SegmentedControl
            size="sm"
            ariaLabel="Dónde se muestra la sección"
            options={OPCIONES_VISIBILIDAD}
            value={visibilidadVista}
            onValueChange={(v) => cambiarVisibilidad(v as Visibilidad)}
          />
        </div>
        {AVISO_VISIBILIDAD[visibilidadVista] ? (
          <Alert tone="warning" title={visibilidadVista === "nunca" ? "Sección oculta" : "Sección restringida"}>
            {AVISO_VISIBILIDAD[visibilidadVista]}
          </Alert>
        ) : null}
        {errores.length > 0 ? (
          <Alert tone="danger" title="No se pudo guardar">
            <ul className="list-disc pl-5">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {carga.estado === "lista" ? (
          <Editor valor={borrador} onChange={setBorrador} />
        ) : carga.estado === "cargando" ? (
          <div className="flex justify-center py-8">
            <Spinner label="Cargando la sección" />
          </div>
        ) : (
          <Alert tone="danger" title="No se pudo abrir el editor">
            <div className="flex flex-col items-start gap-3">
              <p>{carga.mensaje}</p>
              <Button type="button" size="sm" variant="outline" onClick={reintentar}>
                Reintentar
              </Button>
            </div>
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
