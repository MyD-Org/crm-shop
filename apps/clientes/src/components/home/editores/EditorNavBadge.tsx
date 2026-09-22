"use client";

import { useState } from "react";
import { Field, Input, Switch } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";
import type { EditorProps } from "./index";

const DEFAULT_BADGE: NavBadgeContent = { categoria: "ILUMINACION", texto: "Nuevo" };

/**
 * `valor === null` ⇒ badge apagado (Switch "Sin badge" prendido). El Switch
 * prendido manda `onChange(null)`; al apagarlo se recupera el último valor
 * conocido (o el default) para volver a editar categoría/texto.
 */
export function EditorNavBadge({ valor, onChange }: EditorProps<NavBadgeContent | null>) {
  const [ultimo, setUltimo] = useState<NavBadgeContent>(valor ?? DEFAULT_BADGE);

  return (
    <div className="flex flex-col gap-4">
      <Switch
        label="Sin badge"
        checked={valor === null}
        onCheckedChange={(sinBadge) => {
          if (sinBadge) {
            if (valor) setUltimo(valor);
            onChange(null);
          } else {
            onChange(ultimo);
          }
        }}
      />
      {valor !== null ? (
        <>
          <Field label="Categoría" hint="Nombre de la categoría del menú, por ejemplo ILUMINACION">
            <Input value={valor.categoria} onChange={(e) => onChange({ ...valor, categoria: e.target.value })} />
          </Field>
          <Field label="Texto">
            <Input value={valor.texto} onChange={(e) => onChange({ ...valor, texto: e.target.value })} />
          </Field>
        </>
      ) : null}
    </div>
  );
}
