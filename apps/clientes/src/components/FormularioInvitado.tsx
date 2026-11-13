"use client";

import { Field, Input, Select } from "@myd-org/ui";
import { CAMPO_TRAMPA } from "@/lib/arrepentimiento";
import { PROVINCIAS_AR } from "@/lib/provincias";
import { TEXTOS_INVITADO as T } from "@/lib/invitado-textos";
import type { DatosInvitado } from "@/lib/invitado-form";

/**
 * Formularios de la compra como invitado (change `compra-como-invitado`, S2b). No guardan nada:
 * el estado vive en `CheckoutClient` y se pierde al recargar (sin cookie ni almacenamiento).
 *
 * - `FormularioInvitado`: paso «Sus datos» (correo dos veces, nombre, teléfono, facturación).
 * - `DomicilioInvitado`: paso de entrega (código postal; en un retiro, el domicilio de facturación).
 */

const CONDICIONES = [
  { label: "Monotributo", value: "monotributo" },
  { label: "Responsable inscripto", value: "responsable_inscripto" },
  { label: "Exento", value: "exento" },
];

const OPCIONES_PROVINCIA = PROVINCIAS_AR.map((p) => ({ label: p, value: p }));

type Cambiar = (parcial: Partial<DatosInvitado>) => void;

function OpcionModo({
  marcada,
  titulo,
  descripcion,
  onElegir,
}: {
  marcada: boolean;
  titulo: string;
  descripcion: string;
  onElegir: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={onElegir}
      className={`rounded-xl border p-3 text-left transition-colors ${
        marcada ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
    >
      <span className="block text-sm font-semibold text-text">{titulo}</span>
      <span className="block text-xs text-muted">{descripcion}</span>
    </button>
  );
}

export function FormularioInvitado({
  datos,
  errores,
  onCambiar,
  trampa,
  onTrampa,
}: {
  datos: DatosInvitado;
  errores: Record<string, string>;
  onCambiar: Cambiar;
  /** Valor del campo señuelo (los humanos no lo ven; los bots lo completan). */
  trampa: string;
  onTrampa: (v: string) => void;
}) {
  const esFacturaA = datos.modo === "factura_a";
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{T.introDatos}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={T.email} error={errores.email}>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            value={datos.email}
            onChange={(e) => onCambiar({ email: e.target.value })}
          />
        </Field>
        <Field label={T.emailConfirmacion} error={errores.emailConfirmacion}>
          <Input
            type="email"
            autoComplete="off"
            inputMode="email"
            value={datos.emailConfirmacion}
            onChange={(e) => onCambiar({ emailConfirmacion: e.target.value })}
          />
        </Field>
        <Field label={T.nombre} error={errores.nombre}>
          <Input autoComplete="name" value={datos.nombre} onChange={(e) => onCambiar({ nombre: e.target.value })} />
        </Field>
        <Field label={T.telefono} hint={T.telefonoAyuda} error={errores.telefono}>
          <Input
            type="tel"
            autoComplete="tel"
            placeholder="+54 376 4000000"
            value={datos.telefono}
            onChange={(e) => onCambiar({ telefono: e.target.value })}
          />
        </Field>
      </div>

      <div>
        <h3 className="mb-3 text-base font-semibold text-text">{T.tituloFacturacion}</h3>
        <div role="radiogroup" aria-label={T.tituloFacturacion} className="grid gap-3 sm:grid-cols-2">
          <OpcionModo
            marcada={!esFacturaA}
            titulo={T.consumidorFinal}
            descripcion={T.consumidorFinalDescripcion}
            onElegir={() => onCambiar({ modo: "consumidor_final" })}
          />
          <OpcionModo
            marcada={esFacturaA}
            titulo={T.facturaA}
            descripcion={T.facturaADescripcion}
            onElegir={() => onCambiar({ modo: "factura_a" })}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={esFacturaA ? T.cuit : T.dni} error={errores.nroDoc}>
            <Input inputMode="numeric" value={datos.nroDoc} onChange={(e) => onCambiar({ nroDoc: e.target.value })} />
          </Field>
          {esFacturaA && (
            <>
              <Field label={T.razonSocial} error={errores.razonSocial}>
                <Input value={datos.razonSocial} onChange={(e) => onCambiar({ razonSocial: e.target.value })} />
              </Field>
              <Field label={T.condicionIva} error={errores.condicionIva}>
                <Select
                  options={CONDICIONES}
                  value={datos.condicionIva}
                  onValueChange={(v) => onCambiar({ condicionIva: v })}
                  placeholder={T.condicionIvaPlaceholder}
                />
              </Field>
            </>
          )}
        </div>
      </div>

      {/* Señuelo anti-bots: invisible y fuera del orden de tabulación. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Sitio web
          <input
            type="text"
            name={CAMPO_TRAMPA}
            tabIndex={-1}
            autoComplete="off"
            value={trampa}
            onChange={(e) => onTrampa(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

export function DomicilioInvitado({
  datos,
  errores,
  onCambiar,
  aDomicilio,
}: {
  datos: DatosInvitado;
  errores: Record<string, string>;
  onCambiar: Cambiar;
  /** Con envío, el domicilio fiscal es el de la entrega: sólo falta el código postal. */
  aDomicilio: boolean;
}) {
  return (
    <div className="mt-4 space-y-4">
      {!aDomicilio && (
        <div>
          <h3 className="text-base font-semibold text-text">{T.tituloDomicilio}</h3>
          <p className="mb-3 text-sm text-muted">{T.domicilioIntro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={T.calle} error={errores.domicilioCalle}>
                <Input autoComplete="street-address" value={datos.calle} onChange={(e) => onCambiar({ calle: e.target.value })} />
              </Field>
            </div>
            <Field label={T.provincia} error={errores.domicilioProvincia}>
              <Select
                options={OPCIONES_PROVINCIA}
                value={datos.provincia}
                onValueChange={(v) => onCambiar({ provincia: v })}
                placeholder={T.provinciaPlaceholder}
              />
            </Field>
            <Field label={T.ciudad} error={errores.domicilioCiudad}>
              <Input autoComplete="address-level2" value={datos.ciudad} onChange={(e) => onCambiar({ ciudad: e.target.value })} />
            </Field>
          </div>
        </div>
      )}
      <div className="max-w-[12rem]">
        <Field label={aDomicilio ? T.codigoPostalEntrega : T.codigoPostal} error={errores.domicilioCp}>
          <Input
            autoComplete="postal-code"
            maxLength={10}
            value={datos.cp}
            onChange={(e) => onCambiar({ cp: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
