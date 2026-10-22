"use client";

import { useEffect, useState } from "react";
import { Alert, Field, Input, Select } from "@myd-org/ui";
import type { TiendaOficialContent } from "@/data/home-defaults";
import { leerPaginasMarcaParaEditor } from "@/lib/marcas/marcas-acciones";
import { CampoImagen } from "./CampoImagen";
import { SelectorSkusDestacados } from "./SelectorSkusDestacados";
import type { EditorProps } from "./index";

const NINGUNA = "__ninguna__";

/**
 * Bloque "Tienda oficial" de la home: qué página de marca (nivel "oficial")
 * destaca, el título, el botón y hasta 3 productos. Logo, nombre y bajada
 * salen de la página de marca.
 */
export function EditorTiendaOficial({ valor, onChange }: EditorProps<TiendaOficialContent>) {
  const [opciones, setOpciones] = useState<{ value: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    leerPaginasMarcaParaEditor().then(
      (r) => {
        if (!vigente) return;
        if (!r.ok) return setError(r.error);
        setOpciones(
          r.paginas
            .filter((p) => p.nivel === "oficial")
            .map((p) => ({ value: p.slug, label: p.publicada ? p.nombre : `${p.nombre} (oculta)` })),
        );
      },
      () => vigente && setError("No pudimos leer las páginas de marca. Inténtelo nuevamente."),
    );
    return () => {
      vigente = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {opciones && opciones.length === 0 ? (
        <Alert tone="neutral">
          Todavía no hay una tienda oficial. Créela en «Páginas de marca» (/editar-marcas) para destacarla acá.
        </Alert>
      ) : null}
      <Field label="Tienda oficial que se destaca">
        <Select
          options={[{ value: NINGUNA, label: "Ninguna" }, ...(opciones ?? [])]}
          value={valor.slug ?? NINGUNA}
          onValueChange={(v) => onChange({ ...valor, slug: v === NINGUNA ? undefined : v })}
          aria-label="Tienda oficial que se destaca"
        />
      </Field>
      <CampoImagen
        label="Imagen"
        hint="Foto del panel izquierdo, con un velo oscuro para que se lea el texto. Vacía: la foto de fondo del encabezado de la página de la marca."
        valor={valor.imagen ?? ""}
        onChange={(imagen) => onChange({ ...valor, imagen: imagen || undefined })}
        alt={valor.imagenAlt ?? ""}
        onAltChange={(imagenAlt) => onChange({ ...valor, imagenAlt })}
      />
      <Field label="Título" hint="Vacío: la bajada de la página de marca.">
        <Input value={valor.titulo ?? ""} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Botón">
        <Input value={valor.cta} onChange={(e) => onChange({ ...valor, cta: e.target.value })} />
      </Field>
      <div>
        <p className="mb-2 text-sm text-muted">
          Hasta 3 productos. Si elige menos, se completan con otros de la marca.
        </p>
        <SelectorSkusDestacados skus={valor.skus} onChange={(skus) => onChange({ ...valor, skus: skus.slice(0, 3) })} />
      </div>
    </div>
  );
}
