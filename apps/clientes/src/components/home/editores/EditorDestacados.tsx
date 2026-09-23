"use client";

import { Field, Input } from "@myd-org/ui";
import { DEFAULTS_HOME, type DestacadosContent } from "@/data/home-defaults";
import { ListaEditable } from "../ListaEditable";
import { CampoImagen } from "./CampoImagen";
import { CamposTitulo } from "./CamposTitulo";
import { SelectorSkusDestacados } from "./SelectorSkusDestacados";
import type { EditorProps } from "./index";

/**
 * `skus` se edita con un buscador sobre el catálogo (rebanada D, opcional).
 * `imagenes` se edita como lista de `CampoImagen` (rebanada C).
 */
export function EditorDestacados({ valor, onChange }: EditorProps<DestacadosContent>) {
  return (
    <div className="flex flex-col gap-4">
      <CamposTitulo valor={valor} onChange={onChange} />
      <Field label="Enlace de 'Ver todos'" hint="Opcional: ruta interna (por ejemplo /catalogo) o URL https. Si lo deja vacío, no se muestra.">
        <Input value={valor.linkTodos ?? ""} onChange={(e) => onChange({ ...valor, linkTodos: e.target.value })} />
      </Field>
      <Field label="Cantidad" hint="Entre 1 y 24 productos">
        <Input
          type="number"
          min={1}
          max={24}
          value={valor.cantidad}
          onChange={(e) => onChange({ ...valor, cantidad: Number(e.target.value) })}
        />
      </Field>
      <div>
        <p className="mb-2 text-sm font-semibold text-text">Fotos de los destacados</p>
        <ListaEditable
          items={valor.imagenes ?? []}
          onChange={(imagenes) => onChange({ ...valor, imagenes })}
          nuevo={() => DEFAULTS_HOME.destacados.imagenes?.[0] ?? "/images/prod-bulb-warm.webp"}
          renderItem={(item, onItem) => <CampoImagen valor={item} onChange={onItem} />}
        />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-text">Productos destacados</p>
        <p className="mb-2 text-sm text-muted">
          Elija a mano los productos que aparecen primero en &ldquo;Destacados&rdquo;. El resto de la sección se
          completa automáticamente con el catálogo.
        </p>
        <SelectorSkusDestacados skus={valor.skus ?? []} onChange={(skus) => onChange({ ...valor, skus })} />
      </div>
    </div>
  );
}
