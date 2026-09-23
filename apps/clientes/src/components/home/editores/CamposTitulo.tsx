"use client";

import { useRef } from "react";
import { AccentText, Button, Field, Input, Textarea } from "@myd-org/ui";
import type { TextosSeccion } from "@/data/home-defaults";
import { alternarAcento } from "@/lib/home-editor";

const HINT_ACENTO = "Seleccione una o más palabras y toque «Marcar acento» para pintarlas en color acento.";

function CampoConAcento({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function marcar() {
    const input = ref.current;
    if (!input) return;
    const desde = input.selectionStart ?? 0;
    const hasta = input.selectionEnd ?? 0;
    const r = alternarAcento(value, desde, hasta);
    if (!r) {
      input.focus();
      return;
    }
    onChange(r.texto);
    // Deja seleccionado el mismo tramo, ya con (o sin) las marcas.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(r.desde, r.hasta);
    });
  }

  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
          <Button
            type="button"
            variant="outline"
            // Evita que el botón le robe el foco (y la selección) al campo.
            onMouseDown={(e) => e.preventDefault()}
            onClick={marcar}
          >
            Marcar acento
          </Button>
        </div>
        {value.includes("*") ? (
          <p className="text-sm text-muted">
            Vista previa: <AccentText text={value} accentClassName="not-italic font-semibold text-accent" />
          </p>
        ) : null}
      </div>
    </Field>
  );
}

/**
 * Título (con acento en cualquier posición) y bajada, cada uno con su versión
 * opcional para mobile. Si la versión mobile queda vacía, en mobile se muestra
 * el texto de desktop.
 */
export function CamposTitulo<T extends TextosSeccion>({
  valor,
  onChange,
}: {
  valor: T;
  onChange: (v: T) => void;
}) {
  return (
    <>
      <CampoConAcento
        label="Título"
        hint={`Opcional. ${HINT_ACENTO}`}
        value={valor.titulo ?? ""}
        onChange={(titulo) => onChange({ ...valor, titulo })}
      />
      <CampoConAcento
        label="Título en mobile"
        hint="Opcional. Si lo deja vacío, en mobile se muestra el título de arriba."
        value={valor.tituloMobile ?? ""}
        onChange={(tituloMobile) => onChange({ ...valor, tituloMobile })}
      />
      <Field label="Bajada" hint="Opcional">
        <Textarea value={valor.bajada ?? ""} onChange={(e) => onChange({ ...valor, bajada: e.target.value })} />
      </Field>
      <Field label="Bajada en mobile" hint="Opcional. Si la deja vacía, en mobile se muestra la bajada de arriba.">
        <Textarea
          value={valor.bajadaMobile ?? ""}
          onChange={(e) => onChange({ ...valor, bajadaMobile: e.target.value })}
        />
      </Field>
    </>
  );
}
