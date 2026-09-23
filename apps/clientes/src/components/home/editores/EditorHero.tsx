"use client";

import { Field, Input } from "@myd-org/ui";
import type { HeroContent } from "@/data/home-defaults";
import { nuevoEnlace } from "@/lib/home-editor";
import { ListaEditable } from "../ListaEditable";
import { CampoImagen } from "./CampoImagen";
import { CamposTitulo } from "./CamposTitulo";
import type { EditorProps } from "./index";

export function EditorHero({ valor, onChange }: EditorProps<HeroContent>) {
  return (
    <div className="flex flex-col gap-4">
      <CamposTitulo valor={valor} onChange={onChange} conEyebrow />
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
              <Field label="Etiqueta" hint="Vacía: el botón no se muestra">
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
