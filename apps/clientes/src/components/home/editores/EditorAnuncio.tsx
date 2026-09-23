"use client";

import { Field, Input } from "@myd-org/ui";
import type { HomeContent } from "@/data/home-defaults";
import type { EditorProps } from "./index";

export function EditorAnuncio({ valor, onChange }: EditorProps<HomeContent["anuncio"]>) {
  return (
    <Field label="Texto">
      <Input value={valor.texto ?? ""} onChange={(e) => onChange({ ...valor, texto: e.target.value })} />
    </Field>
  );
}
