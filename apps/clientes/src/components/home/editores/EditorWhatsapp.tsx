"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import type { CampoWhatsapp, SoloEn, WhatsappContent } from "@/data/home-defaults";
import { BloqueTexto } from "./CamposTitulo";
import type { EditorProps } from "./index";

export function EditorWhatsapp({ valor, onChange }: EditorProps<WhatsappContent>) {
  const textos = valor.visibilidadTextos ?? {};
  const setVisibilidad = (campo: CampoWhatsapp) => (v: SoloEn | undefined) =>
    onChange({ ...valor, visibilidadTextos: { ...textos, [campo]: v } });
  return (
    <div className="flex flex-col gap-4">
      <BloqueTexto
        etiqueta="Título"
        visibilidad={textos.titulo}
        onVisibilidad={setVisibilidad("titulo")}
        editor={
          <Input aria-label="Título" value={valor.titulo ?? ""} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
        }
      />
      <BloqueTexto
        etiqueta="Texto"
        visibilidad={textos.texto}
        onVisibilidad={setVisibilidad("texto")}
        editor={
          <Textarea aria-label="Texto" value={valor.texto ?? ""} onChange={(e) => onChange({ ...valor, texto: e.target.value })} />
        }
      />
      <Field label="Enlace" hint="Ruta interna (por ejemplo /catalogo) o URL https">
        <Input value={valor.href} onChange={(e) => onChange({ ...valor, href: e.target.value })} />
      </Field>
    </div>
  );
}
