"use client";

import { useState } from "react";
import { Button, Field, Input } from "@myd-org/ui";
import { DireccionAutocomplete } from "./DireccionAutocomplete";
import {
  CONDICION_IVA_LABEL,
  formatearCuit,
  validarFacturacion,
  type CondicionIva,
  type DatosFacturacion,
  type TipoDoc,
} from "@/lib/facturacion";

/**
 * Datos de facturación del comprador.
 *
 * Editables a propósito, y no hay contradicción con la vinculación: acá el CUIT
 * es un dato del comprobante ("emitíme la factura a este número"), no un
 * reclamo de identidad. No otorga precios ni cuenta corriente.
 *
 * Cuando el usuario vinculó su cuenta, Alegra pasa a ser la fuente de verdad y
 * esto se muestra en solo lectura (`bloqueado`).
 */

export interface PerfilFacturacionUI {
  tipoDoc: string;
  nroDoc: string;
  razonSocial: string;
  condicionIva: string;
  domicilioCalle?: string | null;
  domicilioCiudad?: string | null;
  domicilioProvincia?: string | null;
  domicilioCp?: string | null;
  coincideConAlegra?: string | null;
}

const VACIO: DatosFacturacion = {
  // DNI para acompañar el default de abajo: un consumidor final factura con
  // DNI. Dejarlo en CUIT obligaría a cambiar dos campos en vez de ninguno.
  tipoDoc: "DNI",
  nroDoc: "",
  razonSocial: "",
  // Consumidor final por defecto: es el caso más frecuente y el que menos
  // datos exige. Un responsable inscripto sabe que tiene que cambiarlo; un
  // particular no tendría por qué saber qué significa la opción de al lado.
  condicionIva: "consumidor_final",
  domicilioCalle: "",
  domicilioCiudad: "",
  domicilioProvincia: "",
  domicilioCp: "",
};

function desdePerfil(p: PerfilFacturacionUI | null): DatosFacturacion {
  if (!p) return VACIO;
  return {
    tipoDoc: (p.tipoDoc as TipoDoc) ?? "CUIT",
    nroDoc: p.nroDoc ?? "",
    razonSocial: p.razonSocial ?? "",
    condicionIva: (p.condicionIva as CondicionIva) ?? "consumidor_final",
    domicilioCalle: p.domicilioCalle ?? "",
    domicilioCiudad: p.domicilioCiudad ?? "",
    domicilioProvincia: p.domicilioProvincia ?? "",
    domicilioCp: p.domicilioCp ?? "",
  };
}

export function FacturacionForm({
  perfil,
  bloqueado,
  onGuardado,
}: {
  perfil: PerfilFacturacionUI | null;
  /** Vinculado a Alegra: los datos los manda el sistema, no el cliente. */
  bloqueado?: boolean;
  onGuardado?: () => void;
}) {
  const [form, setForm] = useState<DatosFacturacion>(desdePerfil(perfil));
  /**
   * ¿Hay una dirección ya resuelta? Controla si se muestran ciudad, provincia
   * y CP, que arrancan ocultos: primero una sola línea, y el resto aparece
   * cargado cuando el usuario elige una sugerencia.
   *
   * Arranca en `true` si el perfil ya traía ciudad — quien vuelve a la página
   * tiene que ver sus datos, no un formulario que parece vacío.
   */
  const [direccionResuelta, setDireccionResuelta] = useState(
    Boolean(perfil?.domicilioCiudad),
  );
  /**
   * El usuario eligió cargar la dirección a mano.
   *
   * Va aparte de `direccionResuelta` porque cambia una regla: en modo
   * automático, seguir escribiendo la calle invalida lo resuelto y esconde los
   * campos derivados. En modo manual eso sería absurdo — pidió escribirlos él,
   * y verlos desaparecer mientras tipea la calle es desconcertante.
   */
  const [modoManual, setModoManual] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState("");

  function set<K extends keyof DatosFacturacion>(k: K, v: DatosFacturacion[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrores((e) => ({ ...e, [k]: "" }));
  }

  // Consumidor final es el único que puede facturar con DNI.
  const puedeUsarDni = form.condicionIva === "consumidor_final";

  async function guardar() {
    const errs = validarFacturacion(form);
    setErrores(errs);
    if (Object.keys(errs).length > 0) return;

    setGuardando(true);
    setErrorGeneral("");
    try {
      const res = await fetch("/api/mi-cuenta/facturacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrores(json?.errores ?? {});
        setErrorGeneral(json?.error ?? "No pudimos guardar tus datos.");
        return;
      }
      setExito(true);
      setTimeout(() => setExito(false), 3000);
      onGuardado?.();
    } catch {
      setErrorGeneral("No pudimos conectarnos. Revisá tu conexión.");
    } finally {
      setGuardando(false);
    }
  }

  if (bloqueado) {
    return (
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Dato label="Razón social" value={form.razonSocial || "—"} />
        <Dato
          label={form.tipoDoc}
          value={form.tipoDoc === "CUIT" ? formatearCuit(form.nroDoc) : form.nroDoc || "—"}
        />
        <Dato
          label="Condición IVA"
          value={CONDICION_IVA_LABEL[form.condicionIva] ?? "—"}
        />
        <Dato label="Domicilio fiscal" value={form.domicilioCalle || "—"} />
      </dl>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {exito && (
        <div className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success">
          Datos de facturación guardados.
        </div>
      )}
      {errorGeneral && (
        <div className="rounded-lg bg-danger/5 px-4 py-3 text-sm font-medium text-danger">
          {errorGeneral}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Condición frente al IVA" error={errores.condicionIva}>
          <select
            value={form.condicionIva}
            onChange={(e) => {
              const c = e.target.value as CondicionIva;
              set("condicionIva", c);
              // Monotributo y RI no pueden facturar con DNI: se fuerza CUIT
              // acá y no al validar, para que el formulario no muestre una
              // opción que después va a rechazar.
              if (c !== "consumidor_final") set("tipoDoc", "CUIT");
            }}
            className="w-full rounded-sm border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:border-primary"
          >
            {(Object.keys(CONDICION_IVA_LABEL) as CondicionIva[]).map((c) => (
              <option key={c} value={c}>
                {CONDICION_IVA_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={form.condicionIva === "consumidor_final" ? "Nombre y apellido" : "Razón social"}
          error={errores.razonSocial}
        >
          <Input
            value={form.razonSocial}
            onChange={(e) => set("razonSocial", e.target.value)}
            placeholder={
              form.condicionIva === "consumidor_final" ? "Juan Pérez" : "Electricidad SRL"
            }
          />
        </Field>

        <Field label="Tipo de documento" error={errores.tipoDoc}>
          <select
            value={form.tipoDoc}
            onChange={(e) => set("tipoDoc", e.target.value as TipoDoc)}
            disabled={!puedeUsarDni}
            className="w-full rounded-sm border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:border-primary disabled:opacity-60"
          >
            <option value="CUIT">CUIT</option>
            {puedeUsarDni && <option value="DNI">DNI</option>}
          </select>
        </Field>

        <Field label={`Número de ${form.tipoDoc}`} error={errores.nroDoc}>
          <Input
            value={form.nroDoc}
            onChange={(e) => set("nroDoc", e.target.value)}
            placeholder={form.tipoDoc === "CUIT" ? "30-71234567-8" : "27123456"}
            inputMode="numeric"
          />
        </Field>

        {/*
          El domicilio se pide SIEMPRE, no solo a quien discrimina IVA.

          La regla de AFIP para factura B es por MONTO, no por condición fiscal:
          por debajo de cierto importe se puede emitir a "Consumidor Final" sin
          identificar a nadie, pero por encima hay que consignar nombre,
          documento **y domicilio**. Con un mínimo de $100.000 para envío
          gratis, acá superar ese umbral es lo normal, no la excepción.

          Obligatorio solo para quienes discriminan IVA (ver `validarFacturacion`):
          al consumidor final se le pide pero no se le bloquea la compra —
          frenarlo por un dato que en su caso puede no hacer falta es perder la
          venta.

          Ocupa las dos columnas: el desplegable de sugerencias necesita el
          ancho completo para que las direcciones largas no se corten.
        */}
        <div className="sm:col-span-2 flex flex-col gap-4">
            {/*
              Una sola línea al principio; ciudad, provincia y CP aparecen
              recién cuando hay una dirección resuelta y ya vienen cargados. Ese
              es el 90% del valor: son justo los campos que la gente deja mal o
              vacíos, y un CP equivocado en una factura es un problema.
            */}
            <DireccionAutocomplete
              label="Domicilio fiscal"
              value={form.domicilioCalle ?? ""}
              onChange={(v) => {
                set("domicilioCalle", v);
                // Volver a escribir invalida lo resuelto y esconde los campos
                // derivados... salvo en modo manual, donde el usuario ya dijo
                // que los completa él.
                if (!modoManual) setDireccionResuelta(false);
              }}
              onSeleccionar={(s) => {
                setForm((f) => ({
                  ...f,
                  domicilioCalle: s.calle,
                  // Solo se pisa lo que la sugerencia realmente trae: si viene
                  // sin CP, se conserva el que el usuario ya había escrito.
                  domicilioCiudad: s.ciudad || f.domicilioCiudad,
                  domicilioProvincia: s.provincia || f.domicilioProvincia,
                  domicilioCp: s.cp || f.domicilioCp,
                }));
                // Elegir una sugerencia vuelve al modo automático: si antes
                // estaba a mano y ahora sí encontró su calle, que la ayuda
                // vuelva a funcionar.
                setModoManual(false);
                setDireccionResuelta(true);
              }}
              onCargarAMano={() => {
                setModoManual(true);
                setDireccionResuelta(true);
              }}
              suspendido={modoManual}
              placeholder="Escribí la calle y el número…"
              error={errores.domicilioCalle}
            />

            {/*
              Escape a mano. Nominatim no tiene todas las calles cargadas —
              probado: "tejedor puerto iguazu" devuelve cero resultados. Sin
              esta salida, quien vive en una calle que OSM no conoce no puede
              cargar su domicilio y no puede facturar. Un autocompletado nunca
              puede ser la única forma de entrar un dato obligatorio.
            */}
            {!direccionResuelta && (form.domicilioCalle ?? "").trim().length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setModoManual(true);
                  setDireccionResuelta(true);
                }}
                className="self-start text-sm text-primary hover:underline"
              >
                No encuentro mi dirección — cargarla a mano
              </button>
            )}

            {direccionResuelta && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Ciudad" error={errores.domicilioCiudad}>
                  <Input
                    value={form.domicilioCiudad ?? ""}
                    onChange={(e) => set("domicilioCiudad", e.target.value)}
                    placeholder="Puerto Iguazú"
                  />
                </Field>
                <Field label="Provincia">
                  <Input
                    value={form.domicilioProvincia ?? ""}
                    onChange={(e) => set("domicilioProvincia", e.target.value)}
                    placeholder="Misiones"
                  />
                </Field>
                <Field label="Código postal">
                  <Input
                    value={form.domicilioCp ?? ""}
                    onChange={(e) => set("domicilioCp", e.target.value)}
                    placeholder="3370"
                    inputMode="numeric"
                  />
                </Field>
              </div>
            )}
        </div>
      </div>

      <div>
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar datos de facturación"}
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
