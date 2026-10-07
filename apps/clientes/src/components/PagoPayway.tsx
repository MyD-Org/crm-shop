"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, SegmentedControl, Select } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import {
  MARCAS,
  armarSolicitudToken,
  marcaPorPrefijo,
  metodoPagoIdDe,
  normalizarPan,
  validarCvv,
  validarDocumento,
  validarPan,
  validarTitular,
  validarVencimiento,
  type Marca,
  type ModalidadTarjeta,
} from "@/lib/pagos/payway-tarjeta";
import { crearSesionSdk, precargarSdk, tokenizar, type ConfigPayway } from "@/lib/pagos/payway-token";
import { entornoSdkNavegador } from "@/lib/pagos/payway-sdk-navegador";
import { enviarCobro } from "@/lib/pagos/payway-cobro-cliente";
import { PagoEnConfirmacion } from "@/components/PagoEnConfirmacion";

/**
 * Cobro con tarjeta de crédito o débito con Payway, dentro del sitio.
 *
 * Modelo "NO PCI" de Payway: el número y el código de seguridad van del navegador a Payway (SDK
 * oficial, ver `payway-token.ts`) y vuelve un token; a NUESTRO servidor sólo llegan el token, el BIN,
 * el medio de pago y las cuotas (`payway-cobro-cliente.ts`). Esos datos viven únicamente en el estado
 * de este formulario: no se guardan, no se loguean ni se mandan a analítica, y el número y el código
 * se borran apenas se obtiene el token.
 *
 * El monto que se muestra es informativo. El que se cobra sale del pedido persistido en el servidor,
 * igual que las cuotas (congeladas en el pedido: acá no se eligen).
 */

type Estado =
  | { fase: "formulario" }
  | { fase: "procesando" }
  | { fase: "pagado" }
  | { fase: "pendiente" }
  | { fase: "rechazado"; mensaje: string };

interface Props {
  pedidoId: string;
  numero: string;
  monto: number;
  /** Cuotas congeladas en el pedido (1 = un pago). */
  cuotas?: number;
  /** Se llama cuando el cobro quedó confirmado. */
  onPagado: () => void;
  /** Se llama cuando el procesador todavía no confirmó el cobro (queda "Estamos confirmando"). */
  onPendiente?: () => void;
  /** Mientras se confirmaba, el procesador lo rechazó: el formulario vuelve para pagar este mismo pedido. */
  onRechazado?: () => void;
  /** El pedido ya tiene un cobro en curso (se retomó): arranca en "Estamos confirmando su pago". */
  iniciarEnConfirmacion?: boolean;
}

type Errores = Partial<Record<"pan" | "venc" | "cvv" | "titular" | "doc" | "marca" | "modalidad", string>>;

/** Número de a grupos de 4 para leerlo mejor. El valor que se usa es el normalizado. */
const agruparPan = (s: string) => normalizarPan(s).replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");

/** "0830" -> "08/30". */
function formatearVenc(s: string): string {
  const d = s.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function PagoPayway({
  pedidoId,
  numero,
  monto,
  cuotas = 1,
  onPagado,
  onPendiente,
  onRechazado,
  iniciarEnConfirmacion = false,
}: Props) {
  const [estado, setEstado] = useState<Estado>(iniciarEnConfirmacion ? { fase: "pendiente" } : { fase: "formulario" });
  const [config, setConfig] = useState<ConfigPayway | null | "error">(null);

  const [pan, setPan] = useState("");
  const [venc, setVenc] = useState("");
  const [cvv, setCvv] = useState("");
  const [titular, setTitular] = useState("");
  const [doc, setDoc] = useState("");
  const [modalidad, setModalidad] = useState<ModalidadTarjeta>("credito");
  // null = se usa la sugerencia por el prefijo del número.
  const [marcaElegida, setMarcaElegida] = useState<Marca | null>(null);
  const [errores, setErrores] = useState<Errores>({});
  const formRef = useRef<HTMLFormElement>(null);
  // Una sola instancia del SDK por formulario: su huella de dispositivo (Cybersource) tiene que
  // registrarse ANTES de pagar y es la misma con la que se tokeniza.
  const sesionSdk = useRef(crearSesionSdk());

  // La key pública sale del servidor (no hay variable NEXT_PUBLIC_*).
  useEffect(() => {
    let cancelado = false;
    fetch("/api/pagos/payway-config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: ConfigPayway) => {
        if (!cancelado) setConfig(c);
      })
      .catch(() => {
        if (!cancelado) setConfig("error");
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Con la configuración a mano, se prepara el SDK mientras el comprador completa los datos.
  useEffect(() => {
    if (config && config !== "error") void precargarSdk(config, entornoSdkNavegador, sesionSdk.current);
  }, [config]);

  const sugerida = marcaPorPrefijo(pan);
  const marca = marcaElegida ?? sugerida;
  const debitoEnCuotas = modalidad === "debito" && cuotas > 1;
  const cuotasTexto = cuotas > 1 ? `${cuotas} cuotas` : "un pago";

  function validar(): Errores {
    const e: Errores = {};
    const p = validarPan(pan, marca);
    if (!p.ok) e.pan = p.mensaje;
    const v = formatearVenc(venc).split("/");
    const ve = validarVencimiento(v[0] ?? "", v[1] ?? "");
    if (!ve.ok) e.venc = ve.mensaje;
    const c = validarCvv(cvv, marca);
    if (!c.ok) e.cvv = c.mensaje;
    const t = validarTitular(titular);
    if (!t.ok) e.titular = t.mensaje;
    const d = validarDocumento(doc);
    if (!d.ok) e.doc = d.mensaje;
    if (!marca) e.marca = "Seleccione la marca de la tarjeta.";
    else if (metodoPagoIdDe(marca, modalidad) === null) {
      e.marca = modalidad === "debito" ? "Esa tarjeta no admite débito. Elija crédito u otra tarjeta." : "Seleccione la marca de la tarjeta.";
    }
    if (debitoEnCuotas) {
      e.modalidad = "El débito se paga en un solo pago. Vuelva al carrito y elija 1 cuota, o pague con crédito.";
    }
    return e;
  }

  async function pagar(ev: React.FormEvent) {
    ev.preventDefault();
    if (estado.fase === "procesando" || config === null || config === "error") return;

    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) {
      // Foco al primer campo con error.
      const orden = ["pan", "venc", "cvv", "titular", "doc", "marca", "modalidad"] as const;
      const primero = orden.find((k) => e[k]);
      formRef.current?.querySelector<HTMLElement>(`[data-campo="${primero}"]`)?.focus();
      return;
    }

    const metodoPagoId = metodoPagoIdDe(marca, modalidad)!;
    setEstado({ fase: "procesando" });

    const v = formatearVenc(venc).split("/");
    const solicitud = armarSolicitudToken({
      pan,
      mes: v[0] ?? "",
      anio: v[1] ?? "",
      cvv,
      titular,
      nroDoc: doc,
    });

    const token = await tokenizar(solicitud, config, { entorno: entornoSdkNavegador, sesion: sesionSdk.current });
    if (!token.ok) {
      // Sin token no se cobró nada: se conserva lo tipeado para que corrija.
      setEstado({ fase: "rechazado", mensaje: token.mensaje });
      return;
    }

    // Token obtenido: el número y el código ya no hacen falta. Se borran del estado.
    setPan("");
    setCvv("");

    const r = await enviarCobro({ pedidoId, token: token.token, bin: token.bin, metodoPagoId, cuotas });
    if (r.fase === "pagado") {
      setEstado({ fase: "pagado" });
      onPagado();
    } else if (r.fase === "pendiente") {
      setEstado({ fase: "pendiente" });
      onPendiente?.();
    } else {
      setEstado({ fase: "rechazado", mensaje: r.mensaje });
    }
  }

  if (estado.fase === "pagado") {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-5 text-center">
        <p className="text-sm font-bold text-text">Pago acreditado</p>
        <p className="mt-1 text-sm text-muted">
          Cobramos {fmtPrecio(monto)} para el pedido {numero}.
        </p>
      </div>
    );
  }

  if (estado.fase === "pendiente") {
    return (
      <PagoEnConfirmacion
        pedidoId={pedidoId}
        onPagado={() => {
          setEstado({ fase: "pagado" });
          onPagado();
        }}
        onRechazado={(mensaje) => {
          setEstado({ fase: "rechazado", mensaje });
          onRechazado?.();
        }}
      />
    );
  }

  if (config === "error") {
    return (
      <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        El pago con tarjeta no está disponible en este momento. Elija transferencia o escríbanos.
      </p>
    );
  }

  const procesando = estado.fase === "procesando";

  return (
    <form ref={formRef} onSubmit={pagar} noValidate autoComplete="on" className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">
        Pago de {fmtPrecio(monto)} en {cuotasTexto} con tarjeta de crédito o débito.
      </p>

      {estado.fase === "rechazado" && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-4">
          <p className="text-sm font-semibold text-danger">No se pudo completar el pago</p>
          <p className="mt-1 text-sm text-text">{estado.mensaje}</p>
        </div>
      )}

      <Field label="Tipo de tarjeta" error={errores.modalidad}>
        <SegmentedControl
          ariaLabel="Tipo de tarjeta"
          options={[
            { label: "Crédito", value: "credito", disabled: procesando },
            { label: "Débito", value: "debito", disabled: procesando },
          ]}
          value={modalidad}
          onValueChange={(v) => setModalidad(v as ModalidadTarjeta)}
        />
      </Field>

      <Field label="Número de tarjeta" error={errores.pan}>
        <Input
          data-campo="pan"
          name="cc-number"
          autoComplete="cc-number"
          inputMode="numeric"
          placeholder="0000 0000 0000 0000"
          value={pan}
          onChange={(e) => setPan(agruparPan(e.target.value))}
          disabled={procesando}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Vencimiento (MM/AA)" error={errores.venc}>
          <Input
            data-campo="venc"
            name="cc-exp"
            autoComplete="cc-exp"
            inputMode="numeric"
            placeholder="MM/AA"
            value={venc}
            onChange={(e) => setVenc(formatearVenc(e.target.value))}
            disabled={procesando}
          />
        </Field>
        <Field label="Código de seguridad" error={errores.cvv}>
          <Input
            data-campo="cvv"
            name="cc-csc"
            autoComplete="cc-csc"
            inputMode="numeric"
            placeholder={marca === "amex" ? "4 dígitos" : "3 dígitos"}
            maxLength={4}
            value={cvv}
            onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))}
            disabled={procesando}
          />
        </Field>
      </div>

      <Field label="Nombre del titular" hint="Como figura en la tarjeta." error={errores.titular}>
        <Input
          data-campo="titular"
          name="cc-name"
          autoComplete="cc-name"
          value={titular}
          onChange={(e) => setTitular(e.target.value)}
          disabled={procesando}
        />
      </Field>

      <Field label="DNI del titular" error={errores.doc}>
        <Input
          data-campo="doc"
          name="documento"
          autoComplete="off"
          inputMode="numeric"
          value={doc}
          onChange={(e) => setDoc(e.target.value.replace(/[^\d.]/g, ""))}
          disabled={procesando}
        />
      </Field>

      <Field label="Marca" hint={sugerida && !marcaElegida ? "Detectada por el número; puede cambiarla." : undefined} error={errores.marca}>
        <Select
          options={MARCAS.map((m) => ({ label: m.etiqueta, value: m.id }))}
          value={marca ?? ""}
          onValueChange={(v) => setMarcaElegida(v as Marca)}
          placeholder="Seleccionar marca"
          disabled={procesando}
        />
      </Field>

      <Button type="submit" disabled={procesando || config === null}>
        {procesando ? "Procesando su pago…" : `Pagar ${fmtPrecio(monto)}`}
      </Button>

      {procesando && (
        <p role="status" className="text-sm text-muted">
          Estamos procesando su pago. Puede demorar hasta un minuto; no cierre ni recargue esta página.
        </p>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span>Pago seguro: los datos de su tarjeta van directo al procesador y no se guardan en este sitio.</span>
      </p>
    </form>
  );
}
