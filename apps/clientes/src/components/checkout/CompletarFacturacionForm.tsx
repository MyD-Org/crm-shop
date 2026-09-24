"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@myd-org/ui";
import { DireccionAutocomplete } from "@/components/DireccionAutocomplete";
import {
  validarComplemento,
  type CampoFacturacion,
  type Complemento,
  type DatosContacto,
  type LecturaContacto,
} from "@/lib/contacto-alegra";
import {
  CONDICION_IVA_LABEL,
  TIPO_DOC_LABEL,
  formatearDoc,
  formatearDocAlEscribir,
  type CondicionIva,
  type TipoDoc,
} from "@/lib/facturacion";
import { PROVINCIAS_AR, provinciaCanonica } from "@/lib/provincias";
import type { DatosDelContactoPublico } from "@/lib/datos-del-contacto";

/**
 * Completar los datos de facturación del comprador VINCULADO (change
 * `contacto-fuente-unica`). Muestra en lectura lo que ya tiene su cuenta en
 * Alegra y pide SÓLO lo que falta (más provincia y CP, opcionales, si también
 * están vacíos). Nada de lo que ya está se puede editar acá: D1.
 *
 * Valida en el navegador con la MISMA función que el servidor
 * (`validarComplemento`) y manda a `PUT /api/mi-cuenta/facturacion`.
 */

export type ResultadoCompletar =
  | { estado: "alegra" | "perfil" | "sin_cambios" }
  | { estado: "en_pedido"; complemento: Complemento };

const OPCIONES_CONDICION = (Object.keys(CONDICION_IVA_LABEL) as CondicionIva[]).map((c) => ({
  label: CONDICION_IVA_LABEL[c],
  value: c,
}));
const OPCIONES_TIPO = (["CUIT", "DNI"] as TipoDoc[]).map((t) => ({ label: TIPO_DOC_LABEL[t], value: t }));
const OPCIONES_PROVINCIA = PROVINCIAS_AR.map((p) => ({ label: p, value: p }));

/** La lectura con la que valida el navegador (misma forma que la del servidor). */
function lecturaDe(f: DatosDelContactoPublico): LecturaContacto {
  return {
    datos: f.datos as DatosContacto,
    bloqueados: f.bloqueados,
    faltantes: f.faltantes,
    completo: f.completo,
    motivoRevision: f.motivoRevision,
    tipoDocDeducido: f.tipoDocDeducido,
    documentoNorm: null,
  };
}

export function CompletarFacturacionForm({
  facturacion,
  onResultado,
}: {
  facturacion: DatosDelContactoPublico;
  onResultado: (r: ResultadoCompletar) => void;
}) {
  const { datos, faltantes } = facturacion;
  const falta = (c: CampoFacturacion) => faltantes.includes(c);
  const pideDomicilio = falta("domicilioCalle") || falta("domicilioCiudad");
  const pideProvincia = pideDomicilio && !datos.domicilioProvincia;
  const pideCp = pideDomicilio && !datos.domicilioCp;

  const [form, setForm] = useState<Complemento>({});
  const [errores, setErrores] = useState<Partial<Record<CampoFacturacion, string>>>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);

  function set(campo: CampoFacturacion, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setErrores((e) => ({ ...e, [campo]: "" }));
  }

  const tipoDoc = (form.tipoDoc ?? datos.tipoDoc ?? "CUIT") as TipoDoc;

  async function guardar() {
    setErrorGeneral("");
    const r = validarComplemento(lecturaDe(facturacion), form);
    if (!r.ok) {
      if (r.motivo === "invalido") setErrores(r.errores);
      else setErrorGeneral("Ese dato ya figura en su cuenta y no puede modificarse desde la tienda.");
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/mi-cuenta/facturacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r.complemento),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.estado) {
        onResultado(json as ResultadoCompletar);
        return;
      }
      if (res.status === 400 && json?.errores) setErrores(json.errores);
      setErrorGeneral(json?.error ?? "No pudimos guardar sus datos. Inténtelo de nuevo.");
    } catch {
      setErrorGeneral("No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  const documento = datos.nroDoc
    ? `${datos.tipoDoc ? `${TIPO_DOC_LABEL[datos.tipoDoc as TipoDoc] ?? datos.tipoDoc} ` : ""}${formatearDoc(
        (datos.tipoDoc ?? "CUIT") as TipoDoc,
        datos.nroDoc,
      )}`
    : null;

  return (
    <div className="flex flex-col gap-4">
      {(datos.razonSocial || documento) && (
        <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border/50 bg-surface p-3 sm:grid-cols-2">
          {datos.razonSocial && <Dato label="Razón social" value={datos.razonSocial} />}
          {documento && <Dato label="Documento" value={documento} />}
          {datos.condicionIva && !falta("condicionIva") && (
            <Dato label="Condición IVA" value={CONDICION_IVA_LABEL[datos.condicionIva as CondicionIva] ?? datos.condicionIva} />
          )}
          {datos.domicilioCalle && <Dato label="Domicilio fiscal" value={datos.domicilioCalle} />}
        </dl>
      )}

      {errorGeneral && (
        <div role="alert" className="rounded-lg bg-danger/5 px-4 py-3 text-sm font-medium text-danger">
          {errorGeneral}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {falta("razonSocial") && (
          <Field label="Razón social o nombre y apellido" error={errores.razonSocial} className="sm:col-span-2">
            <Input
              value={form.razonSocial ?? ""}
              onChange={(e) => set("razonSocial", e.target.value)}
              placeholder="Como figura en su documento o constancia"
            />
          </Field>
        )}

        {falta("condicionIva") && (
          <Field label="Condición frente al IVA" error={errores.condicionIva} className="sm:col-span-2">
            <Select
              options={OPCIONES_CONDICION}
              value={form.condicionIva ?? ""}
              onValueChange={(v) => set("condicionIva", v)}
              placeholder="Seleccione su condición"
            />
          </Field>
        )}

        {falta("tipoDoc") && (
          <Field label="Tipo de documento" error={errores.tipoDoc}>
            <Select
              options={OPCIONES_TIPO}
              value={form.tipoDoc ?? ""}
              onValueChange={(v) => set("tipoDoc", v)}
              placeholder="Seleccione el tipo"
            />
          </Field>
        )}

        {falta("nroDoc") && (
          <Field label={`Número de ${TIPO_DOC_LABEL[tipoDoc]}`} error={errores.nroDoc}>
            <Input
              value={form.nroDoc ?? ""}
              onChange={(e) => set("nroDoc", formatearDocAlEscribir(tipoDoc, e.target.value))}
              inputMode="numeric"
              placeholder={tipoDoc === "DNI" ? "27123456" : "30-71234567-8"}
            />
          </Field>
        )}

        {falta("domicilioCalle") && (
          <div className="sm:col-span-2">
            <DireccionAutocomplete
              label="Domicilio fiscal"
              value={form.domicilioCalle ?? ""}
              onChange={(v) => set("domicilioCalle", v)}
              onSeleccionar={(s) => {
                // Sólo se completa lo que falta: lo que ya está en su cuenta no se toca.
                setForm((f) => ({
                  ...f,
                  domicilioCalle: s.calle,
                  ...(falta("domicilioCiudad") && s.ciudad ? { domicilioCiudad: s.ciudad } : {}),
                  ...(pideProvincia && provinciaCanonica(s.provincia)
                    ? { domicilioProvincia: provinciaCanonica(s.provincia)! }
                    : {}),
                  ...(pideCp && s.cp ? { domicilioCp: s.cp } : {}),
                }));
                setErrores((e) => ({ ...e, domicilioCalle: "", domicilioCiudad: "" }));
              }}
              placeholder="Escriba la calle y el número…"
              error={errores.domicilioCalle}
            />
          </div>
        )}

        {falta("domicilioCiudad") && (
          <Field label="Ciudad" error={errores.domicilioCiudad}>
            <Input
              value={form.domicilioCiudad ?? ""}
              onChange={(e) => set("domicilioCiudad", e.target.value)}
              placeholder="Puerto Iguazú"
            />
          </Field>
        )}

        {pideProvincia && (
          <Field label="Provincia (opcional)" error={errores.domicilioProvincia}>
            <Select
              options={OPCIONES_PROVINCIA}
              value={form.domicilioProvincia ?? ""}
              onValueChange={(v) => set("domicilioProvincia", v)}
              placeholder="Seleccione la provincia"
            />
          </Field>
        )}

        {pideCp && (
          <Field label="Código postal (opcional)" error={errores.domicilioCp}>
            <Input
              value={form.domicilioCp ?? ""}
              onChange={(e) => set("domicilioCp", e.target.value)}
              inputMode="numeric"
              placeholder="3370"
            />
          </Field>
        )}
      </div>

      <div>
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando sus datos…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-text">{value}</dd>
    </div>
  );
}
