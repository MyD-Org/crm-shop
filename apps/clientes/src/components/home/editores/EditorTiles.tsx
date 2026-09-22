"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import type { DecoGridContent, SeccionTilesContent } from "@/data/home-defaults";
import { nuevoTile } from "@/lib/home-editor";
import { ListaEditable } from "../ListaEditable";
import { CampoImagen } from "./CampoImagen";
import type { EditorProps } from "./index";

/**
 * Editor de tiles compartido por `ambientes` y `decoGrid` (rebanada B2):
 * ambas secciones son un `SeccionTilesContent` (título + items); `decoGrid`
 * además tiene `chips`. La imagen de cada tile se sube a R2 (rebanada C).
 */
export function EditorTiles({
  valor,
  onChange,
}: EditorProps<SeccionTilesContent | DecoGridContent>) {
  const tieneBajada = "bajada" in valor;

  return (
    <div className="flex flex-col gap-4">
      <Field label="Título">
        <Input value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} />
      </Field>
      <Field label="Acento" hint="Opcional: la parte del título en color acento">
        <Input value={valor.acento ?? ""} onChange={(e) => onChange({ ...valor, acento: e.target.value })} />
      </Field>
      {tieneBajada ? (
        <Field label="Bajada" hint="Opcional">
          <Textarea
            value={(valor as SeccionTilesContent).bajada ?? ""}
            onChange={(e) => onChange({ ...valor, bajada: e.target.value })}
          />
        </Field>
      ) : null}
      <Field label="Enlace de 'Ver todos'" hint="Ruta interna (por ejemplo /catalogo) o URL https">
        <Input value={valor.linkTodos} onChange={(e) => onChange({ ...valor, linkTodos: e.target.value })} />
      </Field>
      <div>
        <p className="mb-2 text-sm font-semibold text-text">Tiles</p>
        <ListaEditable
          items={valor.items}
          onChange={(items) => onChange({ ...valor, items })}
          nuevo={nuevoTile}
          renderItem={(item, onItem) => (
            <div className="flex flex-col gap-3">
              <CampoImagen valor={item.imagen} onChange={(imagen) => onItem({ ...item, imagen })} />
              <Field label="Eyebrow">
                <Input value={item.eyebrow} onChange={(e) => onItem({ ...item, eyebrow: e.target.value })} />
              </Field>
              <Field label="Título">
                <Input value={item.titulo} onChange={(e) => onItem({ ...item, titulo: e.target.value })} />
              </Field>
              <Field label="Enlace" hint="Ruta interna (por ejemplo /catalogo) o URL https">
                <Input value={item.href} onChange={(e) => onItem({ ...item, href: e.target.value })} />
              </Field>
            </div>
          )}
        />
      </div>
    </div>
  );
}
