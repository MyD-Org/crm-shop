"use client";

import { Field, Input } from "@myd-org/ui";
import type { BusquedaAsistidaContent, ItemEjemplo } from "@/data/home-defaults";
import { ListaEditable } from "../ListaEditable";
import { CamposTitulo } from "./CamposTitulo";
import type { EditorProps } from "./index";

/** "Cuéntenos qué necesita": textos, texto de ayuda del campo y ejemplos (cada uno busca esa frase). */
export function EditorBusquedaAsistida({ valor, onChange }: EditorProps<BusquedaAsistidaContent>) {
  return (
    <div className="flex flex-col gap-4">
      <CamposTitulo valor={valor} onChange={onChange} conEyebrow />
      <Field label="Texto de ayuda del campo" hint="Se ve dentro del campo de búsqueda, antes de escribir.">
        <Input value={valor.placeholder ?? ""} onChange={(e) => onChange({ ...valor, placeholder: e.target.value })} />
      </Field>
      <Field label="Título de los ejemplos">
        <Input value={valor.ejemplosTitulo ?? ""} onChange={(e) => onChange({ ...valor, ejemplosTitulo: e.target.value })} />
      </Field>
      <span className="text-sm font-medium text-text">Ejemplos</span>
      <ListaEditable
        items={valor.ejemplos}
        onChange={(ejemplos) => onChange({ ...valor, ejemplos })}
        nuevo={(): ItemEjemplo => ({ texto: "" })}
        conVisibilidad
        nombreItem="ejemplo"
        renderItem={(item, onItem) => (
          <Input
            aria-label="Ejemplo"
            maxLength={120}
            value={item.texto}
            onChange={(e) => onItem({ ...item, texto: e.target.value })}
          />
        )}
      />
    </div>
  );
}
