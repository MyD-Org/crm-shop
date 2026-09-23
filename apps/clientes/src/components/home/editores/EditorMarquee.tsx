"use client";

import { Input } from "@myd-org/ui";
import type { MarqueeContent } from "@/data/home-defaults";
import { ListaEditable } from "../ListaEditable";
import type { EditorProps } from "./index";

export function EditorMarquee({ valor, onChange }: EditorProps<MarqueeContent>) {
  return (
    <ListaEditable
      items={valor.items}
      onChange={(items) => onChange({ items })}
      nuevo={() => ({ texto: "" })}
      conVisibilidad
      nombreItem="mensaje"
      renderItem={(item, onItem) => (
        <Input aria-label="Mensaje" value={item.texto} onChange={(e) => onItem({ ...item, texto: e.target.value })} />
      )}
    />
  );
}
