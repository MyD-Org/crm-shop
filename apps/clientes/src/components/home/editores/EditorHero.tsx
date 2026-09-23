"use client";

import { Button, Field, Input } from "@myd-org/ui";
import type { HeroContent } from "@/data/home-defaults";
import { nuevoEnlace } from "@/lib/home-editor";
import { isStudioImage, STUDIO_IMAGE } from "../hero-lights";
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
      {/* La foto del estudio es la única que prende las luces interactivas del hero. */}
      {!isStudioImage(valor.imagen) ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange({ ...valor, imagen: STUDIO_IMAGE, imagenAlt: "Estudio con luminarias de Central Led" })}
        >
          Usar la foto interactiva del estudio
        </Button>
      ) : null}
      <div>
        <p className="mb-2 text-sm font-semibold text-text">Enlaces (CTAs)</p>
        <ListaEditable
          items={valor.ctas}
          onChange={(ctas) => onChange({ ...valor, ctas })}
          nuevo={nuevoEnlace}
          conVisibilidad
          nombreItem="botón"
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
          conVisibilidad
          nombreItem="ventaja"
          renderItem={(item, onItem) => (
            <Field label="Texto">
              <Input value={item.label} onChange={(e) => onItem({ ...item, label: e.target.value })} />
            </Field>
          )}
        />
      </div>
    </div>
  );
}
