"use client";

import type { ReactNode } from "react";
import { Input, Switch, Textarea } from "@myd-org/ui";
import type { CampoOcultable, TextosSeccion } from "@/data/home-defaults";
import { CampoAcento } from "./CampoAcento";

type ConEyebrow = TextosSeccion & { eyebrow?: string };

/**
 * Un texto de la sección: interruptor "Mostrar" (apagado ⇒ se guarda pero no
 * se muestra) y, si el texto admite versión mobile, interruptor "Distinto en
 * mobile" que abre un segundo campo solo para pantallas chicas.
 */
function BloqueTexto({
  etiqueta,
  visible,
  onVisible,
  mobile,
  onMobile,
  editor,
  editorMobile,
}: {
  etiqueta: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  mobile?: boolean;
  onMobile?: (v: boolean) => void;
  editor: ReactNode;
  editorMobile?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text">{etiqueta}</span>
        <Switch size="sm" label="Mostrar" checked={visible} onCheckedChange={onVisible} />
      </div>
      {visible ? (
        <>
          {mobile ? <span className="text-xs font-semibold uppercase tracking-wide text-muted">Desktop</span> : null}
          {editor}
          {mobile ? (
            <>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Mobile</span>
              {editorMobile}
            </>
          ) : null}
          {onMobile ? <Switch size="sm" label="Distinto en mobile" checked={!!mobile} onCheckedChange={onMobile} /> : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Eyebrow, título con acento y bajada de una sección, con sus interruptores.
 * `conEyebrow` para las secciones que lo tienen (portada y banner decorativo).
 */
export function CamposTitulo<T extends ConEyebrow>({
  valor,
  onChange,
  conEyebrow = false,
}: {
  valor: T;
  onChange: (v: T) => void;
  conEyebrow?: boolean;
}) {
  const ocultos = valor.camposOcultos ?? [];
  const visible = (campo: CampoOcultable) => !ocultos.includes(campo);
  const setVisible = (campo: CampoOcultable) => (v: boolean) =>
    onChange({
      ...valor,
      camposOcultos: v ? ocultos.filter((c) => c !== campo) : [...ocultos, campo],
    });
  // Al prender "Distinto en mobile" arranca con el texto de desktop; al
  // apagarlo se descarta (en mobile vuelve a verse el de desktop).
  const setMobile = (campo: "tituloMobile" | "bajadaMobile", base: string | undefined) => (v: boolean) =>
    onChange({ ...valor, [campo]: v ? (base ?? "") : undefined });

  return (
    <>
      {conEyebrow ? (
        <BloqueTexto
          etiqueta="Eyebrow"
          visible={visible("eyebrow")}
          onVisible={setVisible("eyebrow")}
          editor={
            <Input
              aria-label="Eyebrow"
              value={valor.eyebrow ?? ""}
              onChange={(e) => onChange({ ...valor, eyebrow: e.target.value })}
            />
          }
        />
      ) : null}
      <BloqueTexto
        etiqueta="Título"
        visible={visible("titulo")}
        onVisible={setVisible("titulo")}
        mobile={valor.tituloMobile !== undefined}
        onMobile={setMobile("tituloMobile", valor.titulo)}
        editor={
          <CampoAcento
            ariaLabel="Título"
            value={valor.titulo ?? ""}
            onChange={(titulo) => onChange({ ...valor, titulo })}
          />
        }
        editorMobile={
          <CampoAcento
            ariaLabel="Título en mobile"
            value={valor.tituloMobile ?? ""}
            onChange={(tituloMobile) => onChange({ ...valor, tituloMobile })}
          />
        }
      />
      <BloqueTexto
        etiqueta="Bajada"
        visible={visible("bajada")}
        onVisible={setVisible("bajada")}
        mobile={valor.bajadaMobile !== undefined}
        onMobile={setMobile("bajadaMobile", valor.bajada)}
        editor={
          <Textarea
            aria-label="Bajada"
            value={valor.bajada ?? ""}
            onChange={(e) => onChange({ ...valor, bajada: e.target.value })}
          />
        }
        editorMobile={
          <Textarea
            aria-label="Bajada en mobile"
            value={valor.bajadaMobile ?? ""}
            onChange={(e) => onChange({ ...valor, bajadaMobile: e.target.value })}
          />
        }
      />
    </>
  );
}
