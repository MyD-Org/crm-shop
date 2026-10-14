"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, Field, Input, Switch, Textarea, useToast } from "@myd-org/ui";
import type { PaginaParaEditor } from "@/lib/paginas-acciones";
import { guardarPaginaInstitucional, restablecerPaginaInstitucional } from "@/lib/paginas-acciones";
import { MAX_PAGINA } from "@/lib/institucional/paginas";

type BloqueForm = { titulo: string; texto: string };

const aForm = (p: PaginaParaEditor): BloqueForm[] =>
  p.bloques.map((b) => ({ titulo: b.titulo, texto: b.parrafos.join("\n\n") }));

/** Párrafos separados por una línea en blanco. */
export const separarParrafos = (texto: string): string[] =>
  texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * Editor de una página institucional: si está publicada y sus bloques (título +
 * párrafos separados por una línea en blanco). Texto plano: no se admite
 * formato ni enlaces. "Restablecer" vuelve al texto base.
 */
export function DialogoPagina({
  pagina,
  open,
  onOpenChange,
  onGuardado,
}: {
  pagina: PaginaParaEditor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGuardado: () => void;
}) {
  const [publicada, setPublicada] = useState(pagina.publicada);
  const [bloques, setBloques] = useState<BloqueForm[]>(aForm(pagina));
  const [errores, setErrores] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // Reiniciar el borrador al abrir (ajuste de estado durante el render, como DialogoFooter).
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setPublicada(pagina.publicada);
      setBloques(aForm(pagina));
      setErrores([]);
    }
  }

  const setBloque = (i: number, cambio: Partial<BloqueForm>) =>
    setBloques((bs) => bs.map((b, j) => (j === i ? { ...b, ...cambio } : b)));

  function guardar() {
    startTransition(async () => {
      const r = await guardarPaginaInstitucional(pagina.slug, {
        publicada,
        bloques: bloques.map((b) => ({ titulo: b.titulo, parrafos: separarParrafos(b.texto) })),
      });
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: publicada ? "Página guardada y publicada" : "Página guardada", tone: "success" });
      onGuardado();
      onOpenChange(false);
    });
  }

  function restablecer() {
    if (!window.confirm("¿Desea volver al texto base de esta página?")) return;
    startTransition(async () => {
      const r = await restablecerPaginaInstitucional(pagina.slug);
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Texto base restablecido", tone: "success" });
      onGuardado();
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={pagina.titulo}
      description="Escriba en texto simple. Separe los párrafos con una línea en blanco."
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={restablecer} disabled={pending}>
            Restablecer al texto base
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" loading={pending} onClick={guardar}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errores.length > 0 ? (
          <Alert tone="danger" title="No se pudo guardar">
            <ul className="list-disc pl-5">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <Switch checked={publicada} onCheckedChange={setPublicada} label="Publicada" />

        {bloques.map((b, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text">{`Bloque ${i + 1}`}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBloques((bs) => bs.filter((_, j) => j !== i))}
              >
                Quitar
              </Button>
            </div>
            <Field label="Título">
              <Input maxLength={MAX_PAGINA.titulo} value={b.titulo} onChange={(e) => setBloque(i, { titulo: e.target.value })} />
            </Field>
            <Field label="Texto">
              <Textarea rows={6} value={b.texto} onChange={(e) => setBloque(i, { texto: e.target.value })} />
            </Field>
          </div>
        ))}
        {bloques.length < MAX_PAGINA.bloques ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBloques((bs) => [...bs, { titulo: "", texto: "" }])}
            >
              Agregar bloque
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
