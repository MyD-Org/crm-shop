"use client";

import { Field, Input, SegmentedControl } from "@myd-org/ui";
import type { ItemMarquee, MarqueeContent } from "@/data/home-defaults";
import { ListaEditable } from "../ListaEditable";
import { CampoImagen } from "./CampoImagen";
import type { EditorProps } from "./index";

const OPCIONES_TIPO = [
  { value: "texto", label: "Texto" },
  { value: "logo", label: "Logo" },
];

/**
 * Cada ítem de la cinta es un texto o un logo. Con logo, `texto` guarda el
 * nombre de la marca (texto alternativo). Pasar a "Texto" descarta el logo.
 */
export function EditorMarquee({ valor, onChange }: EditorProps<MarqueeContent>) {
  return (
    <ListaEditable
      items={valor.items}
      onChange={(items) => onChange({ items })}
      nuevo={(): ItemMarquee => ({ texto: "", logo: "" })}
      conVisibilidad
      nombreItem="ítem"
      renderItem={(item, onItem) => {
        const esLogo = item.logo !== undefined;
        return (
          <div className="flex flex-col gap-3">
            <SegmentedControl
              size="sm"
              ariaLabel="Tipo de ítem"
              options={OPCIONES_TIPO}
              value={esLogo ? "logo" : "texto"}
              onValueChange={(v) => {
                if (v === "logo") onItem({ ...item, logo: item.logo ?? "" });
                else onItem({ texto: item.texto, visibilidad: item.visibilidad });
              }}
            />
            {esLogo ? (
              <>
                <CampoImagen
                  label="Logo"
                  contener
                  valor={item.logo ?? ""}
                  onChange={(logo) => onItem({ ...item, logo })}
                  hint="PNG con fondo transparente. En la cinta se ve en gris."
                />
                <Field label="Nombre de la marca">
                  <Input value={item.texto} onChange={(e) => onItem({ ...item, texto: e.target.value })} />
                </Field>
              </>
            ) : (
              <Input aria-label="Mensaje" value={item.texto} onChange={(e) => onItem({ ...item, texto: e.target.value })} />
            )}
          </div>
        );
      }}
    />
  );
}
