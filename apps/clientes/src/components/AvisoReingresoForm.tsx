"use client";

import { useActionState, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Alert, Button, Checkbox, Field, Input } from "@myd-org/ui";
import { solicitarAvisoReingreso } from "@/lib/aviso-reingreso-acciones";
import { CAMPO_TRAMPA, CANTIDAD_MAX, CANTIDAD_MIN, LARGOS, TEXTOS } from "@/lib/aviso-reingreso-textos";
import type { EstadoAviso } from "@/lib/aviso-reingreso-validacion";
import { useHidratado } from "@/lib/hidratado";

/**
 * "Avisarme cuando ingrese" en la ficha de un producto agotado (flag `aviso-reingreso`). Server action
 * con `useActionState`. Cerrado es un botón; al abrirlo se marca el momento (`iniciado`, en el
 * navegador: la acción rechaza los envíos hechos en menos de 3 s) y se muestra el form. El campo trampa
 * queda fuera de pantalla y del orden de tabulación.
 *
 * Con sesión de Clerk no se pide el correo: se muestra a cuál se avisará y la acción lo toma de la
 * cuenta en el servidor. Sin sesión se pide. WhatsApp y su consentimiento aparecen solo si la persona tilda "Me interesa
 * encargarlo". No promete reserva ni precio.
 *
 * `alegraId` es el de la variante elegida; la ficha lo monta con `key` por producto, así que cambiar
 * de variante reinicia el form.
 */
const INICIAL: EstadoAviso = { estado: "inicial" };

/** Email principal de la cuenta si hay sesión (después de hidratar); "" sin sesión. */
function useEmailDeCuenta(): string {
  const hidratado = useHidratado();
  const { user } = useUser();
  return (hidratado ? user?.primaryEmailAddress?.emailAddress : undefined) ?? "";
}

export function AvisoReingresoForm({ alegraId }: { alegraId: string }) {
  const [estado, accion, pending] = useActionState(solicitarAvisoReingreso, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [iniciado, setIniciado] = useState("");
  const [encargar, setEncargar] = useState(false);
  const [consentimiento, setConsentimiento] = useState(false);
  const emailCuenta = useEmailDeCuenta();

  if (estado.estado === "ok") {
    return (
      <Alert tone="success" role="status" data-testid="aviso-reingreso-ok">
        {estado.encargar ? TEXTOS.okEncargar : TEXTOS.ok}
      </Alert>
    );
  }

  if (!abierto) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => {
          setIniciado(String(Date.now()));
          setAbierto(true);
        }}
      >
        {TEXTOS.boton}
      </Button>
    );
  }

  const errores = estado.estado === "error" ? estado.errores : {};

  return (
    <form
      action={accion}
      noValidate
      className="relative flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
      aria-label={TEXTOS.titulo}
    >
      <p className="text-sm text-muted">
        {emailCuenta ? TEXTOS.descripcionConCuenta(emailCuenta) : TEXTOS.descripcion}
      </p>
      {estado.estado === "error" && estado.mensaje ? (
        <Alert tone="danger" role="alert">
          {estado.mensaje}
        </Alert>
      ) : null}

      {emailCuenta ? null : (
        <Field label={TEXTOS.etiquetaEmail} error={errores.email}>
          <Input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={LARGOS.email}
          />
        </Field>
      )}
      <Field label={TEXTOS.etiquetaCantidad} error={errores.cantidad}>
        <Input
          name="cantidad"
          type="number"
          inputMode="numeric"
          min={CANTIDAD_MIN}
          max={CANTIDAD_MAX}
          step={1}
          required
          defaultValue="1"
        />
      </Field>

      <div className="flex items-start gap-3">
        <Checkbox id="aviso-encargar" checked={encargar} onCheckedChange={setEncargar} aria-describedby="aviso-encargar-ayuda" />
        <div>
          <label htmlFor="aviso-encargar" className="text-sm font-semibold text-text">
            {TEXTOS.etiquetaEncargar}
          </label>
          <p id="aviso-encargar-ayuda" className="text-xs text-muted">
            {TEXTOS.ayudaEncargar}
          </p>
        </div>
      </div>

      {encargar ? (
        <>
          <Field label={TEXTOS.etiquetaWhatsapp} error={errores.whatsapp}>
            <Input name="whatsapp" type="tel" inputMode="tel" autoComplete="tel" maxLength={LARGOS.whatsapp} />
          </Field>
          <div className="flex items-start gap-3">
            <Checkbox id="aviso-consentimiento" checked={consentimiento} onCheckedChange={setConsentimiento} />
            <div>
              <label htmlFor="aviso-consentimiento" className="text-sm text-text">
                {TEXTOS.etiquetaConsentimiento}
              </label>
              {errores.consentimiento ? (
                <p role="alert" className="text-xs text-danger">
                  {errores.consentimiento}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label>
          No completar
          <input type="text" name={CAMPO_TRAMPA} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <input type="hidden" name="alegraId" value={alegraId} />
      <input type="hidden" name="iniciado" value={iniciado} />
      {encargar ? <input type="hidden" name="quiereEncargar" value="on" /> : null}
      {encargar && consentimiento ? <input type="hidden" name="consentimientoContacto" value="on" /> : null}

      <p className="text-xs text-muted">{TEXTOS.aclaracion}</p>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? TEXTOS.enviando : TEXTOS.enviar}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)} disabled={pending}>
          {TEXTOS.cerrar}
        </Button>
      </div>
    </form>
  );
}
