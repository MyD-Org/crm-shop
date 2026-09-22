"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import type { HeroContent } from "@/data/home-defaults";
import { nuevoEnlace } from "@/lib/home-editor";
import { ListaEditable } from "../ListaEditable";
import type { EditorProps } from "./index";

export function EditorHero({ valor, onChange }: EditorProps<HeroContent>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Eyebrow">
        <Input value={valor.eyebrow} onChange={(e) => onChange({ ...valor, eyebrow: e.target.value })} />
      </Field>
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Acento" hint="Opcional: la parte del título en color acento">
        <Input value={valor.acento ?? ""} onChange={(e) => onChange({ ...valor, acento: e.target.value })} />
      </Field>
      <Field label="Bajada">
        <Textarea value={valor.bajada} onChange={(e) => onChange({ ...valor, bajada: e.target.value })} />
      </Field>
      {/* La imagen se edita desde la rebanada C (subida a R2); acá es solo lectura. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- previa de solo lectura; se reemplaza por CampoImagen en la rebanada C */}
      <img src={valor.imagen} alt="" className="h-24 w-auto rounded-md object-cover" />
      <p className="text-sm text-muted">La imagen se podrá cambiar próximamente.</p>
      <Field label="Texto alternativo de la imagen">
        <Input value={valor.imagenAlt} onChange={(e) => onChange({ ...valor, imagenAlt: e.target.value })} />
      </Field>
      <div>
        <p className="mb-2 text-sm font-semibold text-text">Enlaces (CTAs)</p>
        <ListaEditable
          items={valor.ctas}
          onChange={(ctas) => onChange({ ...valor, ctas })}
          nuevo={nuevoEnlace}
          renderItem={(item, onItem) => (
            <div className="flex flex-col gap-3">
              <Field label="Etiqueta">
                <Input value={item.label} onChange={(e) => onItem({ ...item, label: e.target.value })} />
              </Field>
              <Field label="Enlace" hint="Ruta interna (por ejemplo /catalogo) o URL https">
                <Input value={item.href} onChange={(e) => onItem({ ...item, href: e.target.value })} />
              </Field>
            </div>
          )}
        />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-text">Ventajas (USPs)</p>
        <ListaEditable
          items={valor.usps}
          onChange={(usps) => onChange({ ...valor, usps })}
          nuevo={() => ({ label: "" })}
          min={1}
          renderItem={(item, onItem) => (
            <Field label="Texto">
              <Input value={item.label} onChange={(e) => onItem({ label: e.target.value })} />
            </Field>
          )}
        />
      </div>
    </div>
  );
}
