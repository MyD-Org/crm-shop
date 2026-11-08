"use client";

import { Field, Input, Textarea } from "@myd-org/ui";
import { MAX_VISITENOS, type VisitenosContent } from "@/data/home-defaults";
import { CamposTitulo } from "./CamposTitulo";
import { SelectorVisibilidad } from "./SelectorVisibilidad";
import type { EditorProps } from "./index";

/**
 * Banda "Visítenos" (sólo se muestra con la textura de piedra prendida en el sitio): título y
 * bajada con sus interruptores, dirección, horarios, el botón "Cómo llegar" y el botón de WhatsApp
 * (abre el mismo WhatsApp de la sección «Contacto por WhatsApp»).
 */
export function EditorVisitenos({ valor, onChange }: EditorProps<VisitenosContent>) {
  const cta = valor.cta ?? { label: "", href: "" };
  const wa = valor.whatsapp ?? { label: "" };
  return (
    <div className="flex flex-col gap-4">
      <CamposTitulo valor={valor} onChange={onChange} conEyebrow />
      <Field label="Dirección" hint="Calle, número y ciudad. Vacía: no se muestra">
        <Input
          maxLength={MAX_VISITENOS.direccion}
          value={valor.direccion ?? ""}
          onChange={(e) => onChange({ ...valor, direccion: e.target.value })}
        />
      </Field>
      <Field label="Horarios" hint="Un renglón por cada día o rango. Vacío: no se muestran">
        <Textarea
          maxLength={MAX_VISITENOS.horarios}
          value={valor.horarios ?? ""}
          onChange={(e) => onChange({ ...valor, horarios: e.target.value })}
        />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-text">Botón «Cómo llegar»</p>
        <SelectorVisibilidad
          ariaLabel="Dónde se muestra el botón Cómo llegar"
          valor={cta.visibilidad}
          onChange={(visibilidad) => onChange({ ...valor, cta: { ...cta, visibilidad } })}
        />
      </div>
      <Field label="Etiqueta" hint="Vacía: la banda no muestra botón">
        <Input value={cta.label} onChange={(e) => onChange({ ...valor, cta: { ...cta, label: e.target.value } })} />
      </Field>
      <Field label="Enlace" hint="URL https del mapa o ruta interna (por ejemplo /catalogo)">
        <Input value={cta.href} onChange={(e) => onChange({ ...valor, cta: { ...cta, href: e.target.value } })} />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-text">Botón de WhatsApp</p>
        <SelectorVisibilidad
          ariaLabel="Dónde se muestra el botón de WhatsApp"
          valor={wa.visibilidad}
          onChange={(visibilidad) => onChange({ ...valor, whatsapp: { ...wa, visibilidad } })}
        />
      </div>
      <Field label="Etiqueta del botón de WhatsApp" hint="Vacía: la banda no muestra el botón. Abre el WhatsApp de «Contacto por WhatsApp»">
        <Input value={wa.label} onChange={(e) => onChange({ ...valor, whatsapp: { ...wa, label: e.target.value } })} />
      </Field>
      <Field label="Texto sobre el botón" hint="Opcional. Vacío: solo se muestra el botón">
        <Textarea
          maxLength={MAX_VISITENOS.textoWhatsapp}
          value={wa.texto ?? ""}
          onChange={(e) => onChange({ ...valor, whatsapp: { ...wa, texto: e.target.value } })}
        />
      </Field>
    </div>
  );
}
