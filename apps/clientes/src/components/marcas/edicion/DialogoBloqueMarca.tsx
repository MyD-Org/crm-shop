"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Alert, Button, Dialog, SegmentedControl, Spinner, useToast } from "@myd-org/ui";
import type { Visibilidad } from "@/data/home-defaults";
import { OPCIONES_VISIBILIDAD } from "@/components/home/editores/SelectorVisibilidad";
import {
  cambiarVisibilidadBloqueMarca,
  guardarBloqueMarca,
  leerPaginaMarcaParaEditar,
} from "@/lib/marcas/marcas-acciones";
import type { BloqueMarca } from "@/lib/marcas/pagina-marca";
import { EDITORES_MARCA, TITULOS_BLOQUE, VACIOS } from "./editores";

const ERROR_CARGA = "No se pudo cargar el bloque. Inténtelo de nuevo.";
const AVISO: Record<Visibilidad, string | null> = {
  siempre: null,
  desktop: "En celulares este bloque no se muestra.",
  mobile: "En computadoras este bloque no se muestra.",
  nunca: "Los visitantes no ven este bloque. Puede editarlo igual y mostrarlo cuando quiera.",
};

type Carga = { estado: "cargando" } | { estado: "lista" } | { estado: "error"; mensaje: string };

/**
 * Diálogo de un bloque de una página de marca, como `DialogoSeccion` de la
 * home: pide el contenido fresco al abrirse, monta el editor del bloque y
 * guarda con `guardarBloqueMarca`. "Mostrar en" se aplica al instante. El
 * refresco lo hace la invalidación del tag `home` dentro de las acciones.
 */
export function DialogoBloqueMarca({
  slug,
  bloque,
  visibilidad,
  open,
  onOpenChange,
}: {
  slug: string;
  bloque: BloqueMarca;
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
  const [visibilidadVista, setVisibilidadVista] = useOptimistic(visibilidad);

  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setBorrador(undefined);
      setCarga({ estado: "cargando" });
      setErrores([]);
    }
  }

  useEffect(() => {
    if (!open) return;
    let vigente = true;
    leerPaginaMarcaParaEditar(slug).then(
      (r) => {
        if (!vigente) return;
        if (r.ok) {
          setBorrador(r.pagina.bloques[bloque] ?? VACIOS[bloque]);
          setCarga({ estado: "lista" });
        } else {
          setCarga({ estado: "error", mensaje: r.error });
        }
      },
      () => vigente && setCarga({ estado: "error", mensaje: ERROR_CARGA }),
    );
    return () => {
      vigente = false;
    };
  }, [open, slug, bloque, intento]);

  const Editor = EDITORES_MARCA[bloque];

  function guardar() {
    startTransition(async () => {
      const r = await guardarBloqueMarca(slug, bloque, borrador);
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Bloque guardado", tone: "success" });
      onOpenChange(false);
    });
  }

  function cambiarVisibilidad(nueva: Visibilidad) {
    if (nueva === visibilidadVista) return;
    startTransition(async () => {
      setVisibilidadVista(nueva);
      const r = await cambiarVisibilidadBloqueMarca(slug, bloque, nueva);
      if (!r.ok) setErrores(r.errores);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={TITULOS_BLOQUE[bloque]}
      size="lg"
      footer={
        <>
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
            ariaLabel="Dónde se muestra el bloque"
            options={OPCIONES_VISIBILIDAD}
            value={visibilidadVista}
            onValueChange={(v) => cambiarVisibilidad(v as Visibilidad)}
          />
        </div>
        {AVISO[visibilidadVista] ? <Alert tone="warning">{AVISO[visibilidadVista]}</Alert> : null}
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
            <Spinner label="Cargando el bloque" />
          </div>
        ) : (
          <Alert tone="danger" title="No se pudo abrir el editor">
            <div className="flex flex-col items-start gap-3">
              <p>{carga.mensaje}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setIntento((n) => n + 1)}>
                Reintentar
              </Button>
            </div>
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
