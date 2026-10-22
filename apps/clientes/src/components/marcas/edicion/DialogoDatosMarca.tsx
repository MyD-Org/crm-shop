"use client";

import { useEffect, useState, useTransition } from "react";
import { Alert, Button, Dialog, Field, Input, SegmentedControl, Spinner, Switch, Textarea, useToast } from "@myd-org/ui";
import { CampoImagen } from "@/components/home/editores/CampoImagen";
import { guardarDatosMarca, leerPaginaMarcaParaEditar } from "@/lib/marcas/marcas-acciones";
import { TEMAS_MARCA, temaDe, type PaginaMarca, type TemaMarca } from "@/lib/marcas/pagina-marca";
import { SelectorValoresMarca } from "../SelectorValoresMarca";

type Datos = Pick<PaginaMarca, "nombre" | "bajada" | "logo" | "tema" | "acento" | "seo" | "publicada" | "marcasCatalogo" | "nivel">;

const OPCIONES_TEMA = [
  { value: "oscuro", label: "Oscuro" },
  { value: "claro", label: "Claro" },
];

/**
 * Datos generales de una página de marca: nombre, bajada, logo, acento (solo
 * tienda oficial), marcas del catálogo, SEO y "Publicada". El contenido de
 * cada bloque se edita en su propio diálogo.
 */
export function DialogoDatosMarca({
  slug,
  open,
  onOpenChange,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // Al abrir, borrador limpio (ajuste de estado durante el render, como `DialogoSeccion`).
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setDatos(null);
      setError(null);
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
          const { nombre, bajada, logo, tema, acento, seo, publicada, marcasCatalogo, nivel } = r.pagina;
          setDatos({ nombre, bajada, logo, tema, acento, seo, publicada, marcasCatalogo, nivel });
        } else setError(r.error);
      },
      () => vigente && setError("No se pudo cargar la página. Inténtelo de nuevo."),
    );
    return () => {
      vigente = false;
    };
  }, [open, slug]);

  function guardar() {
    if (!datos) return;
    startTransition(async () => {
      const r = await guardarDatosMarca(slug, { ...datos, acento: datos.acento || undefined, logo: datos.logo || undefined });
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Datos guardados", tone: "success" });
      onOpenChange(false);
    });
  }

  const set = (cambios: Partial<Datos>) => setDatos((d) => (d ? { ...d, ...cambios } : d));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Datos de la página"
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" loading={pending} disabled={!datos} onClick={guardar}>
            Guardar
          </Button>
        </>
      }
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !datos ? (
        <div className="flex justify-center py-8">
          <Spinner label="Cargando la página" />
        </div>
      ) : (
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
          <Switch
            label="Publicada (visible para los clientes)"
            checked={datos.publicada}
            onCheckedChange={(publicada) => set({ publicada })}
          />
          <Field label="Nombre">
            <Input value={datos.nombre} onChange={(e) => set({ nombre: e.target.value })} />
          </Field>
          <Field label="Bajada" hint="Una línea de quiénes son. Se muestra en el encabezado y en el menú.">
            <Textarea value={datos.bajada} onChange={(e) => set({ bajada: e.target.value })} />
          </Field>
          <CampoImagen label="Logo" contener valor={datos.logo ?? ""} onChange={(logo) => set({ logo })} />
          {datos.nivel === "oficial" ? (
            <>
              <Field label="Tema" hint="Los colores de fondo del contenido de la página. El encabezado y el pie de la tienda no cambian.">
                <SegmentedControl
                  size="sm"
                  ariaLabel="Tema de la página"
                  options={OPCIONES_TEMA}
                  value={temaDe(datos)}
                  onValueChange={(v) => set({ tema: v as TemaMarca })}
                />
              </Field>
              <Field
                label="Color de acento"
                hint={`Formato #rrggbb. Tiene que leerse bien sobre el fondo ${temaDe(datos) === "claro" ? "claro" : "oscuro"}. Vacío: ${TEMAS_MARCA[temaDe(datos)].acento}.`}
              >
                <Input
                  value={datos.acento ?? ""}
                  placeholder={TEMAS_MARCA[temaDe(datos)].acento}
                  onChange={(e) => set({ acento: e.target.value })}
                />
              </Field>
            </>
          ) : null}
          <Field label="Marcas del catálogo" hint="Cómo figura esta marca en el catálogo. Si aparece escrita de varias formas, elija todas.">
            <SelectorValoresMarca elegidos={datos.marcasCatalogo} onChange={(marcasCatalogo) => set({ marcasCatalogo })} />
          </Field>
          <Field label="Título para buscadores" hint="Vacío: se arma con el nombre.">
            <Input value={datos.seo?.titulo ?? ""} onChange={(e) => set({ seo: { ...datos.seo, titulo: e.target.value || undefined } })} />
          </Field>
          <Field label="Descripción para buscadores" hint="Vacío: la bajada.">
            <Textarea
              value={datos.seo?.descripcion ?? ""}
              onChange={(e) => set({ seo: { ...datos.seo, descripcion: e.target.value || undefined } })}
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
