"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import type { WhatsappContent } from "@/data/home-defaults";
import type { EditorProps } from "./index";

export function EditorWhatsapp({ valor, onChange }: EditorProps<WhatsappContent>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Texto">
        <Textarea value={valor.texto} onChange={(e) => onChange({ ...valor, texto: e.target.value })} />
      </Field>
      <Field label="Enlace" hint="Ruta interna (por ejemplo /catalogo) o URL https">
        <Input value={valor.href} onChange={(e) => onChange({ ...valor, href: e.target.value })} />
      </Field>
    </div>
  );
}
