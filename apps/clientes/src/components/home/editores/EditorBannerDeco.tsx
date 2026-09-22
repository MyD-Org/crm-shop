"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import type { BannerDecoContent } from "@/data/home-defaults";
import { CampoImagen } from "./CampoImagen";
import type { EditorProps } from "./index";

export function EditorBannerDeco({ valor, onChange }: EditorProps<BannerDecoContent>) {
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
      <CampoImagen valor={valor.imagen} onChange={(imagen) => onChange({ ...valor, imagen })} />
      <p className="text-sm font-semibold text-text">Enlace del banner</p>
      <Field label="Etiqueta">
        <Input value={valor.cta.label} onChange={(e) => onChange({ ...valor, cta: { ...valor.cta, label: e.target.value } })} />
      </Field>
      <Field label="Enlace" hint="Ruta interna (por ejemplo /catalogo) o URL https">
        <Input value={valor.cta.href} onChange={(e) => onChange({ ...valor, cta: { ...valor.cta, href: e.target.value } })} />
      </Field>
    </div>
  );
}
