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
      nuevo={() => ""}
      renderItem={(item, onItem) => <Input value={item} onChange={(e) => onItem(e.target.value)} />}
    />
  );
}
