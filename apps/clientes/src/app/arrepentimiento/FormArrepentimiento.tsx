"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@myd-org/ui";
import { CAMPO_TRAMPA, LARGOS, type EstadoArrepentimiento } from "@/lib/arrepentimiento";
import { enviarSolicitudArrepentimiento } from "@/lib/arrepentimiento-acciones";

/**
 * Formulario del Botón de arrepentimiento: server action con `useActionState`
 * (funciona sin JS). Al registrarse, el form se reemplaza por el código de la
 * solicitud (Res. 424/2020).
 *
 * `iniciado` lo pinta el servidor (`Date.now()` en page.tsx, nunca acá): la
 * acción rechaza los envíos hechos en menos de 3 s. El campo trampa queda fuera
 * de pantalla y fuera del orden de tabulación; una persona no lo ve.
 */
const INICIAL: EstadoArrepentimiento = { estado: "inicial" };

export function FormArrepentimiento({ iniciado }: { iniciado: number }) {
  const [estado, accion, pending] = useActionState(enviarSolicitudArrepentimiento, INICIAL);

  if (estado.estado === "ok") {
    return (
      <Alert tone="success" title="Solicitud registrada" role="status">
        <p>
          Su solicitud fue registrada con el código <strong className="font-semibold">{estado.codigo}</strong>. Guárdelo
          para cualquier consulta.
        </p>
        <p className="mt-2">
          {estado.mailCliente
            ? `Le enviamos una copia a ${estado.email}.`
            : "No pudimos enviarle la copia por correo; conserve este código."}
        </p>
      </Alert>
    );
  }

  const errores = estado.estado === "error" ? estado.errores : {};
  const valores = estado.estado === "error" ? estado.valores : undefined;

  return (
    <form action={accion} noValidate className="relative flex flex-col gap-4">
      {estado.estado === "error" && estado.mensaje ? (
        <Alert tone="danger" role="alert">
          {estado.mensaje}
        </Alert>
      ) : null}

      <Field label="Nombre y apellido" error={errores.nombre}>
        <Input name="nombre" autoComplete="name" required maxLength={LARGOS.nombre} defaultValue={valores?.nombre} />
      </Field>
      <Field label="Correo electrónico" error={errores.email}>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={LARGOS.email}
          defaultValue={valores?.email}
        />
      </Field>
      <Field label="Teléfono" error={errores.telefono}>
        <Input
          name="telefono"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          maxLength={LARGOS.telefono}
          defaultValue={valores?.telefono}
        />
      </Field>
      <Field label="Número de pedido (opcional)" hint="Si lo tiene a mano, por ejemplo PED-00001000." error={errores.pedido}>
        <Input name="pedido" maxLength={LARGOS.pedido} defaultValue={valores?.pedido} />
      </Field>
      <Field label="Motivo (opcional)" hint="No es obligatorio indicar el motivo." error={errores.motivo}>
        <Textarea name="motivo" rows={4} maxLength={LARGOS.motivo} defaultValue={valores?.motivo} />
      </Field>

      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label>
          No completar
          <input type="text" name={CAMPO_TRAMPA} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <input type="hidden" name="iniciado" value={String(iniciado)} />

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enviando…" : "Enviar solicitud"}
        </Button>
      </div>
    </form>
  );
}
