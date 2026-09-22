"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@myd-org/ui";
import { DireccionAutocomplete } from "./DireccionAutocomplete";
import {
  CONDICION_IVA_LABEL,
  PAIS_DEFAULT,
  PAIS_LABEL,
  TIPO_DOC_LABEL,
  TIPOS_DOC_POR_PAIS,
  formatearDoc,
  formatearDocAlEscribir,
  telefonoValido,
  validarFacturacion,
  type CondicionIva,
  type DatosFacturacion,
  type Pais,
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
  pais?: string | null;
  tipoDoc: string;
  nroDoc: string;
  razonSocial: string;
  condicionIva: string;
  domicilioCalle?: string | null;
  domicilioCiudad?: string | null;
  domicilioProvincia?: string | null;
  domicilioCp?: string | null;
  telefono?: string | null;
  coincideConAlegra?: string | null;
}

const CONDICION_IVA_OPTIONS = (Object.keys(CONDICION_IVA_LABEL) as CondicionIva[]).map((c) => ({
  label: CONDICION_IVA_LABEL[c],
  value: c,
}));

const PAIS_OPTIONS = (Object.keys(PAIS_LABEL) as Pais[]).map((p) => ({
  label: PAIS_LABEL[p],
  value: p,
}));

/** Ejemplo de cada documento, con la puntuación con la que la gente lo escribe. */
const PLACEHOLDER_DOC: Record<TipoDoc, string> = {
  CUIT: "30-71234567-8",
  DNI: "27123456",
  CPF: "123.456.789-09",
  CNPJ: "12.345.678/0001-95",
  CI: "4123456",
  RUC: "80012345-6",
};

const SELECT_CLASS =
  "border-[1.5px] border-border-strong focus-visible:border-primary focus-visible:ring-0";

const VACIO: DatosFacturacion = {
  pais: PAIS_DEFAULT,
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
  telefono: "",
};

function desdePerfil(p: PerfilFacturacionUI | null): DatosFacturacion {
  if (!p) return VACIO;
  return {
    // Los perfiles anteriores al campo son todos argentinos.
    pais: (p.pais as Pais) ?? PAIS_DEFAULT,
    tipoDoc: (p.tipoDoc as TipoDoc) ?? "CUIT",
    // Se guarda sin guiones; se muestra como se escribe.
    nroDoc: formatearDocAlEscribir((p.tipoDoc as TipoDoc) ?? "CUIT", p.nroDoc ?? "", {
      alSalir: true,
    }),
    razonSocial: p.razonSocial ?? "",
    condicionIva: (p.condicionIva as CondicionIva) ?? "consumidor_final",
    domicilioCalle: p.domicilioCalle ?? "",
    domicilioCiudad: p.domicilioCiudad ?? "",
    domicilioProvincia: p.domicilioProvincia ?? "",
    domicilioCp: p.domicilioCp ?? "",
    telefono: p.telefono ?? "",
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

  const esArgentina = form.pais === "AR";
  // En Argentina, consumidor final es el único que puede facturar con DNI:
  // monotributo y responsable inscripto solo ven CUIT. Afuera no hay condición
  // frente al IVA y se ofrecen los dos documentos del país.
  const tiposDoc =
    esArgentina && form.condicionIva !== "consumidor_final"
      ? TIPOS_DOC_POR_PAIS.AR.slice(0, 1)
      : TIPOS_DOC_POR_PAIS[form.pais];
  const esPersona = esArgentina && form.condicionIva === "consumidor_final";

  /** Cambia el tipo y reacomoda lo ya escrito a la forma del documento nuevo. */
  function cambiarTipoDoc(tipoDoc: TipoDoc) {
    setForm((f) => ({
      ...f,
      tipoDoc,
      nroDoc: formatearDocAlEscribir(tipoDoc, f.nroDoc, { alSalir: true }),
    }));
    setErrores((e) => ({ ...e, tipoDoc: "", nroDoc: "" }));
  }

  function cambiarPais(pais: Pais) {
    const argentina = pais === "AR";
    setForm((f) => ({
      ...f,
      pais,
      // El documento de un país no sirve en otro: se arranca de cero con el de
      // persona, que es el caso más frecuente, en vez de dejar un número que
      // seguro no valida.
      tipoDoc: argentina ? "DNI" : TIPOS_DOC_POR_PAIS[pais][1],
      nroDoc: "",
      condicionIva: "consumidor_final",
    }));
    setErrores((e) => ({ ...e, pais: "", tipoDoc: "", nroDoc: "", condicionIva: "" }));
  }

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
      <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Dato label="Razón social" value={form.razonSocial || "—"} />
        <Dato
          label={TIPO_DOC_LABEL[form.tipoDoc] ?? form.tipoDoc}
          value={formatearDoc(form.tipoDoc, form.nroDoc) || "—"}
        />
        <Dato label="País" value={PAIS_LABEL[form.pais] ?? "—"} />
        {esArgentina && (
          <Dato
            label="Condición IVA"
            value={CONDICION_IVA_LABEL[form.condicionIva] ?? "—"}
          />
        )}
        <Dato label="Domicilio fiscal" value={form.domicilioCalle || "—"} />
      </dl>
      {/*
        El teléfono es lo único editable con la cuenta vinculada: la razón
        social y el CUIT los manda Alegra, pero a quién llamar por un pedido
        lo decide el cliente. Sin perfil guardado no hay fila donde ponerlo.
      */}
      {perfil && (
        <TelefonoContactoForm
          inicial={form.telefono ?? ""}
          onGuardado={onGuardado}
        />
      )}
      </div>
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
        <Field label="País" error={errores.pais}>
          <Select
            options={PAIS_OPTIONS}
            value={form.pais}
            onValueChange={(v) => cambiarPais(v as Pais)}
            className={SELECT_CLASS}
          />
        </Field>

        {/* La condición frente al IVA es un concepto argentino: afuera no se pregunta. */}
        {esArgentina && (
          <Field label="Condición frente al IVA" error={errores.condicionIva}>
            <Select
              options={CONDICION_IVA_OPTIONS}
              value={form.condicionIva}
              onValueChange={(v) => {
                const c = v as CondicionIva;
                set("condicionIva", c);
                // Monotributo y RI no pueden facturar con DNI: se fuerza CUIT
                // acá y no al validar, para que el formulario no muestre una
                // opción que después va a rechazar.
                if (c !== "consumidor_final") cambiarTipoDoc("CUIT");
              }}
              className={SELECT_CLASS}
            />
          </Field>
        )}

        <Field
          label={
            !esArgentina
              ? "Nombre y apellido o razón social"
              : esPersona
                ? "Nombre y apellido"
                : "Razón social"
          }
          error={errores.razonSocial}
          // En Argentina la fila de arriba ya está completa (país + condición).
          className={esArgentina ? "sm:col-span-2" : undefined}
        >
          <Input
            value={form.razonSocial}
            onChange={(e) => set("razonSocial", e.target.value)}
            // Indicación y no un ejemplo: un nombre o una razón social inventados
            // pueden coincidir con alguien real.
            placeholder={
              esArgentina && !esPersona
                ? "Como figura en la constancia de inscripción"
                : "Como figura en su documento"
            }
          />
        </Field>

        <Field label="Tipo de documento" error={errores.tipoDoc}>
          <Select
            options={tiposDoc.map((t) => ({ label: TIPO_DOC_LABEL[t], value: t }))}
            value={form.tipoDoc}
            onValueChange={(v) => cambiarTipoDoc(v as TipoDoc)}
            disabled={tiposDoc.length === 1}
            className={SELECT_CLASS}
          />
        </Field>

        <Field label={`Número de ${TIPO_DOC_LABEL[form.tipoDoc]}`} error={errores.nroDoc}>
          <Input
            value={form.nroDoc}
            // Los guiones y puntos se ponen solos. El del RUC recién al salir
            // del campo: su número no tiene largo fijo.
            onChange={(e) => set("nroDoc", formatearDocAlEscribir(form.tipoDoc, e.target.value))}
            onBlur={() =>
              set("nroDoc", formatearDocAlEscribir(form.tipoDoc, form.nroDoc, { alSalir: true }))
            }
            placeholder={PLACEHOLDER_DOC[form.tipoDoc]}
            // El CNPJ nuevo trae letras: con teclado numérico no se podría tipear.
            inputMode={form.tipoDoc === "CNPJ" ? "text" : "numeric"}
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

        {/*
          Vive acá y no solo en el checkout para que se pida UNA vez: el
          checkout lo precarga desde el perfil. No es obligatorio para guardar
          los datos fiscales (no frena la factura), pero el pedido sí lo exige.
        */}
        <Field
          label="Teléfono de contacto"
          hint="Se precarga al finalizar cada pedido."
          error={errores.telefono}
        >
          <Input
            type="tel"
            value={form.telefono ?? ""}
            onChange={(e) => set("telefono", e.target.value)}
            placeholder="+54 376 4000000"
          />
        </Field>
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

/**
 * Editor del teléfono solo. Se usa cuando el resto del perfil está en solo
 * lectura (cuenta vinculada): pega al PATCH, que no toca nada más.
 */
function TelefonoContactoForm({
  inicial,
  onGuardado,
}: {
  inicial: string;
  onGuardado?: () => void;
}) {
  const [telefono, setTelefono] = useState(inicial);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);

  async function guardar() {
    if (!telefonoValido(telefono)) {
      setError("Ingrese un teléfono válido, con código de área.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const res = await fetch("/api/mi-cuenta/facturacion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.errores?.telefono ?? json?.error ?? "No pudimos guardar el teléfono.");
        return;
      }
      setExito(true);
      setTimeout(() => setExito(false), 3000);
      onGuardado?.();
    } catch {
      setError("No pudimos conectarnos. Revise su conexión.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {exito && (
        <div className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success">
          Teléfono guardado.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Teléfono de contacto"
          hint="Se precarga al finalizar cada pedido."
          error={error}
        >
          <Input
            type="tel"
            value={telefono}
            onChange={(e) => {
              setTelefono(e.target.value);
              setError("");
            }}
            placeholder="+54 376 4000000"
          />
        </Field>
      </div>
      <div>
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar teléfono"}
        </Button>
      </div>
    </div>
  );
}
