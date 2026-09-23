"use client";

import { Field, Input } from "@myd-org/ui";
import type { BannerDecoContent } from "@/data/home-defaults";
import { CampoImagen } from "./CampoImagen";
import { CamposTitulo } from "./CamposTitulo";
import type { EditorProps } from "./index";

export function EditorBannerDeco({ valor, onChange }: EditorProps<BannerDecoContent>) {
  const cta = valor.cta ?? { label: "", href: "" };
  return (
    <div className="flex flex-col gap-4">
      <CamposTitulo valor={valor} onChange={onChange} conEyebrow />
      <CampoImagen valor={valor.imagen} onChange={(imagen) => onChange({ ...valor, imagen })} />
      <p className="text-sm font-semibold text-text">Botón del banner</p>
      <Field label="Etiqueta" hint="Vacía: el banner no muestra botón">
        <Input value={cta.label} onChange={(e) => onChange({ ...valor, cta: { ...cta, label: e.target.value } })} />
      </Field>
      <Field label="Enlace" hint="Ruta interna (por ejemplo /catalogo) o URL https">
        <Input value={cta.href} onChange={(e) => onChange({ ...valor, cta: { ...cta, href: e.target.value } })} />
      </Field>
    </div>
  );
}
