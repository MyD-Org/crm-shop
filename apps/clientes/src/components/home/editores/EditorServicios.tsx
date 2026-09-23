"use client";

import { Field, Input } from "@myd-org/ui";
import type { ServiciosContent } from "@/data/home-defaults";
import { nuevoServicio } from "@/lib/home-editor";
import { ListaEditable } from "../ListaEditable";
import type { EditorProps } from "./index";

export function EditorServicios({ valor, onChange }: EditorProps<ServiciosContent>) {
  return (
    <ListaEditable
      items={valor.items}
      onChange={(items) => onChange({ items })}
      nuevo={nuevoServicio}
      conVisibilidad
      nombreItem="servicio"
      renderItem={(item, onItem) => (
        <div className="flex flex-col gap-3">
          <Field label="Título">
            <Input value={item.titulo ?? ""} onChange={(e) => onItem({ ...item, titulo: e.target.value })} />
          </Field>
          <Field label="Texto">
            <Input value={item.texto ?? ""} onChange={(e) => onItem({ ...item, texto: e.target.value })} />
          </Field>
        </div>
      )}
    />
  );
}
