"use client";

import { useState } from "react";
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea } from "@myd-org/ui";
import { DireccionAutocomplete } from "@/components/DireccionAutocomplete";
import type { DireccionPrellenada } from "@/lib/direccion-envio";
import {
  LARGOS_DIRECCION,
  avisoFueraDeZona,
  fueraDeZona,
  type CampoDireccion,
} from "@/lib/direcciones-envio";
import {
  conFacturacion,
  conSugerencia,
  type FormularioDireccion,
} from "@/lib/direcciones-envio-cliente";
import { PROVINCIAS_AR } from "@/lib/provincias";

const OPCIONES_PROVINCIA = PROVINCIAS_AR.map((p) => ({ label: p, value: p }));

/**
 * Alta o edición de una dirección de envío, dentro de la misma sección
 * (no navega a otra página). Cualquier localidad del país: la calle se
 * autocompleta contra `/api/geocode` (todo el país) y los demás campos quedan
 * siempre a la vista, así que una calle que el geocodificador no conoce se
 * carga igual. Si la localidad queda fuera de la zona de envío, se avisa pero
 * se guarda.
 */
export function DireccionForm({
  titulo,
  inicial,
  facturacion,
  ofrecerFacturacion,
  esPredeterminada,
  guardando,
  error,
  errores,
  onGuardar,
  onCancelar,
}: {
  titulo: string;
  inicial: FormularioDireccion;
  /** Domicilio de facturación para el atajo; null = no hay. */
  facturacion: DireccionPrellenada | null;
  /** Mostrar "Usar la misma dirección de facturación". */
  ofrecerFacturacion: boolean;
  /** Ya es la predeterminada: no se ofrece marcarla. */
  esPredeterminada: boolean;
  guardando: boolean;
  error: string | null;
  errores: Partial<Record<CampoDireccion, string>>;
  onGuardar: (f: FormularioDireccion) => void;
  onCancelar: () => void;
}) {
  const [form, setForm] = useState<FormularioDireccion>(inicial);
  /** Lo que había antes de aplicar la facturación, para volver al destildar. */
  const [respaldo, setRespaldo] = useState<FormularioDireccion | null>(null);

  const set = <K extends keyof FormularioDireccion>(campo: K, valor: FormularioDireccion[K]) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  function usarFacturacion(activo: boolean) {
    if (activo && facturacion) {
      setRespaldo(form);
      setForm(conFacturacion(form, facturacion));
    } else if (respaldo) {
      setForm((f) => ({
        ...f,
        etiqueta: respaldo.etiqueta,
        calle: respaldo.calle,
        ciudad: respaldo.ciudad,
        provincia: respaldo.provincia,
        cp: respaldo.cp,
      }));
      setRespaldo(null);
    }
  }

  const ciudad = form.ciudad.trim();

  return (
    <Card title={titulo} className="sm:col-span-2">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onGuardar(form);
        }}
      >
        {ofrecerFacturacion && facturacion && (
          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox checked={respaldo !== null} onCheckedChange={usarFacturacion} />
            Usar la misma dirección de facturación
          </label>
        )}

        <Field
          label="Etiqueta (opcional)"
          hint="Por ejemplo, Casa u Obra."
          error={errores.etiqueta}
        >
          <Input
            value={form.etiqueta}
            maxLength={LARGOS_DIRECCION.etiqueta}
            onChange={(e) => set("etiqueta", e.target.value)}
          />
        </Field>

        <DireccionAutocomplete
          label="Calle y número"
          value={form.calle}
          onChange={(v) => {
            set("calle", v);
            setRespaldo(null);
          }}
          onSeleccionar={(s) => {
            setForm((f) => conSugerencia(f, s));
            setRespaldo(null);
          }}
          placeholder="Escriba la calle y el número…"
          error={errores.calle}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Localidad" error={errores.ciudad}>
            <Input
              value={form.ciudad}
              maxLength={LARGOS_DIRECCION.ciudad}
              onChange={(e) => set("ciudad", e.target.value)}
            />
          </Field>
          <Field label="Provincia" error={errores.provincia}>
            <Select
              options={OPCIONES_PROVINCIA}
              value={form.provincia}
              onValueChange={(v) => set("provincia", v)}
              placeholder="Seleccione la provincia"
              aria-invalid={Boolean(errores.provincia)}
            />
          </Field>
          <Field label="Código postal" error={errores.cp}>
            <Input
              value={form.cp}
              maxLength={8}
              onChange={(e) => set("cp", e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Referencias (opcional)"
          hint="Indicaciones para quien entrega: entre calles, portón, timbre."
          error={errores.referencias}
        >
          <Textarea
            rows={2}
            value={form.referencias}
            maxLength={LARGOS_DIRECCION.referencias}
            onChange={(e) => set("referencias", e.target.value)}
          />
        </Field>

        {ciudad && fueraDeZona({ ciudad }) && (
          <Alert tone="warning">{avisoFueraDeZona(ciudad)}</Alert>
        )}

        {!esPredeterminada && (
          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox
              checked={form.predeterminada}
              onCheckedChange={(v) => set("predeterminada", v)}
            />
            Usar como dirección predeterminada
          </label>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={guardando}>
            Guardar dirección
          </Button>
          <Button type="button" variant="ghost" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
