"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import type { HeroContent } from "@/data/home-defaults";
import { nuevoEnlace } from "@/lib/home-editor";
import { ListaEditable } from "../ListaEditable";
import { CampoImagen } from "./CampoImagen";
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
      <CampoImagen
        valor={valor.imagen}
        onChange={(imagen) => onChange({ ...valor, imagen })}
        alt={valor.imagenAlt}
        onAltChange={(imagenAlt) => onChange({ ...valor, imagenAlt })}
      />
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
