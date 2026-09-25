"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, Field, Input, Textarea, useToast } from "@myd-org/ui";
import {
  MAX_FOOTER,
  nuevoLocal,
  type DatosFooter,
  type EnlaceFooter,
  type LocalFooter,
} from "@/data/footer";
import { guardarFooter, restablecerFooter } from "@/lib/home-acciones";

/**
 * Editor del footer global (fila `footer` de home_content): descripción,
 * columna "Contacto" (WhatsApp, locales y enlaces extra) y textos de la barra
 * inferior. Se abre desde la barra de edición de la home y desde el botón
 * "Editar footer" que ven los admins arriba del footer. "Mi cuenta" y
 * "Legales" no se editan. El refresco lo hace `updateTag(TAG_HOME)` en la acción.
 *
 * Con un solo local el editor no muestra títulos ni "Quitar": son los campos
 * y listo. "Agregar local" suma el segundo.
 */
export function DialogoFooter({
  inicial,
  open,
  onOpenChange,
}: {
  inicial: DatosFooter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [borrador, setBorrador] = useState<DatosFooter>(inicial);
  const [errores, setErrores] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // Reiniciar el borrador al abrir (ajuste de estado durante el render, como DialogoSeccion).
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setBorrador(copiar(inicial));
      setErrores([]);
    }
  }

  const set = <K extends keyof DatosFooter>(campo: K, valor: DatosFooter[K]) =>
    setBorrador((b) => ({ ...b, [campo]: valor }));

  const setLocal = (i: number, cambio: Partial<LocalFooter>) =>
    set(
      "locales",
      borrador.locales.map((l, j) => (j === i ? { ...l, ...cambio } : l)),
    );

  const setEnlace = (i: number, cambio: Partial<EnlaceFooter>) =>
    set(
      "enlaces",
      borrador.enlaces.map((e, j) => (j === i ? { ...e, ...cambio } : e)),
    );

  function guardar() {
    startTransition(async () => {
      const r = await guardarFooter(borrador);
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Footer guardado", tone: "success" });
      onOpenChange(false);
    });
  }

  function restablecer() {
    if (!window.confirm("¿Desea restablecer el footer original?")) return;
    startTransition(async () => {
      const r = await restablecerFooter();
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      toast({ title: "Footer restablecido", tone: "success" });
      onOpenChange(false);
    });
  }

  const varios = borrador.locales.length > 1;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Footer"
      description="Pie de página de todas las páginas. Las columnas Mi cuenta y Legales no se editan."
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={restablecer} disabled={pending}>
            Restablecer valores originales
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

        <Field label="Descripción">
          <Textarea
            rows={3}
            maxLength={MAX_FOOTER.descripcion}
            value={borrador.descripcion}
            onChange={(e) => set("descripcion", e.target.value)}
          />
        </Field>

        <Field label="WhatsApp" hint="Número con código de país, por ejemplo 54 9 11 1234 5678. Vacío: no se muestra.">
          <Input
            inputMode="tel"
            value={borrador.whatsapp}
            onChange={(e) => set("whatsapp", e.target.value)}
          />
        </Field>

        {borrador.locales.map((local, i) => (
          <div key={i} className={varios ? "flex flex-col gap-3 rounded-lg border border-border p-3" : "flex flex-col gap-3"}>
            {varios ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text">{`Local ${i + 1}`}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set("locales", borrador.locales.filter((_, j) => j !== i))}
                >
                  Quitar
                </Button>
              </div>
            ) : null}
            <Field label="Dirección" hint="Se muestra en la columna Contacto. Vacía: el enlace dice Ubicación.">
              <Input
                maxLength={MAX_FOOTER.direccion}
                value={local.direccion}
                onChange={(e) => setLocal(i, { direccion: e.target.value })}
              />
            </Field>
            <Field label="Enlace del mapa (opcional)" hint="Si lo deja vacío, se busca la dirección en Google Maps.">
              <Input
                type="url"
                inputMode="url"
                value={local.mapsUrl}
                onChange={(e) => setLocal(i, { mapsUrl: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre del local (opcional)">
                <Input
                  maxLength={MAX_FOOTER.nombre}
                  value={local.nombre}
                  onChange={(e) => setLocal(i, { nombre: e.target.value })}
                />
              </Field>
              <Field label="Horario (opcional)">
                <Input
                  maxLength={MAX_FOOTER.horario}
                  value={local.horario}
                  onChange={(e) => setLocal(i, { horario: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}
        {borrador.locales.length < MAX_FOOTER.locales ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set("locales", [...borrador.locales, nuevoLocal()])}
            >
              Agregar local
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-text">Otros enlaces de Contacto</span>
          {borrador.enlaces.map((enlace, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-end">
              <div className="sm:flex-1">
                <Field label="Texto">
                  <Input
                    maxLength={MAX_FOOTER.etiqueta}
                    value={enlace.label}
                    onChange={(e) => setEnlace(i, { label: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:flex-[2]">
                <Field label="Dirección web" hint="https://… o una ruta de la tienda, como /catalogo.">
                  <Input value={enlace.href} onChange={(e) => setEnlace(i, { href: e.target.value })} />
                </Field>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("enlaces", borrador.enlaces.filter((_, j) => j !== i))}
              >
                Quitar
              </Button>
            </div>
          ))}
          {borrador.enlaces.length < MAX_FOOTER.enlaces ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set("enlaces", [...borrador.enlaces, { label: "", href: "" }])}
              >
                Agregar enlace
              </Button>
            </div>
          ) : null}
        </div>

        <Field label="Texto de la barra inferior (izquierda)" hint="Escriba {anio} para mostrar el año en curso.">
          <Input
            maxLength={MAX_FOOTER.barra}
            value={borrador.barraIzquierda}
            onChange={(e) => set("barraIzquierda", e.target.value)}
          />
        </Field>
        <Field label="Texto de la barra inferior (derecha)">
          <Input
            maxLength={MAX_FOOTER.barra}
            value={borrador.barraDerecha}
            onChange={(e) => set("barraDerecha", e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function copiar(d: DatosFooter): DatosFooter {
  return { ...d, locales: d.locales.map((l) => ({ ...l })), enlaces: d.enlaces.map((e) => ({ ...e })) };
}
