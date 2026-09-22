"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import { DEFAULTS_HOME, type DestacadosContent } from "@/data/home-defaults";
import { ListaEditable } from "../ListaEditable";
import { CampoImagen } from "./CampoImagen";
import type { EditorProps } from "./index";

/**
 * `skus` se conserva sin UI (curación de productos: rebanada D opcional).
 * `imagenes` se edita como lista de `CampoImagen` (rebanada C).
 */
export function EditorDestacados({ valor, onChange }: EditorProps<DestacadosContent>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Acento" hint="Opcional: la parte del título en color acento">
        <Input value={valor.acento ?? ""} onChange={(e) => onChange({ ...valor, acento: e.target.value })} />
      </Field>
      <Field label="Bajada" hint="Opcional">
        <Textarea value={valor.bajada ?? ""} onChange={(e) => onChange({ ...valor, bajada: e.target.value })} />
      </Field>
      <Field label="Enlace de 'Ver todos'" hint="Ruta interna (por ejemplo /catalogo) o URL https">
        <Input value={valor.linkTodos} onChange={(e) => onChange({ ...valor, linkTodos: e.target.value })} />
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
      <p className="text-sm text-muted">La selección de productos (SKUs) se podrá editar en una próxima versión.</p>
    </div>
  );
}
