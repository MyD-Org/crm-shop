"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Field, Input, RadioGroup, Select, type RadioOption } from "@myd-org/ui";
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
import { AvisoProcesador } from "@/components/AvisoProcesador";
import { modalidadesPaywayHabilitadas } from "@/components/pago-opciones";
import { asegurarCuotasDelPedido } from "@/lib/checkout-cuotas-cliente";
import {
  avisoCuotasNoDisponibles,
  claveDelPedido,
  eleccionPayway,
  opcionesCuotasPayway,
  opcionesDeRespaldo,
  textoBotonPagar,
  type EleccionCuotas,
} from "@/lib/cuotas-formulario";
import { SelectorCuotas } from "@/components/checkout/SelectorCuotas";
import { useOpcionesCuotas } from "@/components/checkout/useOpcionesCuotas";
import type { OpcionCobro } from "@/lib/pagos/opciones-cobro";
import { IconoCandado, IconoTarjeta, IconoTarjetaDebito, TituloComoPagar } from "@/components/PagoIconos";

/**
 * Cobro con tarjeta de crédito o débito con Payway, dentro del sitio: "¿Cómo quiere pagar?" con las dos
 * tarjetas (`RadioGroup` del DS) y el formulario dentro de la elegida, igual que con Mercado Pago.
 *
 * Modelo "NO PCI" de Payway: el número y el código de seguridad van del navegador a Payway (SDK
 * oficial, ver `payway-token.ts`) y vuelve un token; a NUESTRO servidor sólo llegan el token, el BIN,
 * el medio de pago y las cuotas (`payway-cobro-cliente.ts`). Esos datos viven únicamente en el estado
 * de este formulario: no se guardan, no se loguean ni se mandan a analítica, y el número y el código
 * se borran apenas se obtiene el token.
 *
 * Las cuotas se eligen en el desplegable "Cuotas" (`SelectorCuotas`, el mismo de Mercado Pago), sólo en
 * crédito: 1 pago y las sin interés de la tienda para la marca detectada por el número o elegida a mano
 * (Payway no ofrece cuotas con interés). Débito: sin desplegable y en 1 pago. Al pagar, el pedido pasa
 * primero a las cuotas elegidas (`asegurarCuotasDelPedido`) y recién después se tokeniza y se cobra. El
 * monto que se muestra es informativo: el que se cobra sale del pedido persistido en el servidor, que
 * vuelve a validar las cuotas y la marca.
 */

/** Procesador que financiaría las cuotas con interés (no hay en Payway; el aviso lo nombra si aparecen). */
const PROCESADOR = "Payway";

type Estado =
  | { fase: "formulario" }
  | { fase: "procesando" }
  | { fase: "pagado" }
  | { fase: "pendiente" }
  /** `noCobrable`: el pedido ya no se puede pagar (vencido o cancelado): sin formulario. */
  | { fase: "rechazado"; mensaje: string; noCobrable?: boolean };

interface Props {
  pedidoId: string;
  numero: string;
  monto: number;
  /** Medio de pago del pedido (slug): va en el `POST /medio` que re-congela las cuotas antes de cobrar. */
  pagoMetodo: string;
  /** Cuotas congeladas hoy en el pedido (null = sin elegir, cuenta como 1 pago). */
  cuotasPedido: number | null;
  /** Lo elegido en el desplegable, para el resumen lateral (null al salir del formulario). Estable. */
  onEleccionCuotas?: (e: EleccionCuotas | null) => void;
  /** El pedido pasó a otras cuotas (y otro total) antes de cobrar. */
  onPedidoActualizado?: (p: { cuotas: number | null; total: number }) => void;
  /**
   * Formas de pago habilitadas para el medio en el admin (migración 0073 del CRM). Sin valor, crédito
   * y débito. Las deshabilitadas no se muestran; el servidor igual las rechaza.
   */
  opcionesCobro?: readonly OpcionCobro[];
  /** Se llama cuando el cobro quedó confirmado. */
  onPagado: () => void;
  /** Se llama cuando el procesador todavía no confirmó el cobro (queda "Estamos confirmando"). */
  onPendiente?: () => void;
  /** Mientras se confirmaba, el procesador lo rechazó: el formulario vuelve para pagar este mismo pedido. */
  onRechazado?: () => void;
  /** El pedido ya tiene un cobro en curso (se retomó): arranca en "Estamos confirmando su pago". */
  iniciarEnConfirmacion?: boolean;
  /** Hay un cobro en vuelo: el checkout oculta "Cambiar medio de pago" y "Volver al carrito". */
  onCobroEnCurso?: (enCurso: boolean) => void;
  /** "Estamos confirmando" se agotó sin resultado: el checkout vuelve a ofrecer otras salidas. */
  onConfirmacionAgotada?: () => void;
}

type Errores = Partial<Record<"pan" | "venc" | "cvv" | "titular" | "doc" | "marca", string>>;

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
  pagoMetodo,
  cuotasPedido,
  onEleccionCuotas,
  onPedidoActualizado,
  opcionesCobro,
  onPagado,
  onPendiente,
  onRechazado,
  iniciarEnConfirmacion = false,
  onCobroEnCurso,
  onConfirmacionAgotada,
}: Props) {
  const [estado, setEstado] = useState<Estado>(iniciarEnConfirmacion ? { fase: "pendiente" } : { fase: "formulario" });
  const cobroEnCurso = estado.fase === "procesando";
  useEffect(() => {
    onCobroEnCurso?.(cobroEnCurso);
  }, [cobroEnCurso, onCobroEnCurso]);
  const [config, setConfig] = useState<ConfigPayway | null | "error">(null);

  const [pan, setPan] = useState("");
  const [venc, setVenc] = useState("");
  const [cvv, setCvv] = useState("");
  const [titular, setTitular] = useState("");
  const [doc, setDoc] = useState("");
  const habilitadas = modalidadesPaywayHabilitadas(opcionesCobro);
  // Arranca en la primera modalidad habilitada (el débito pasa el pedido a 1 pago al cobrar).
  const [modalidad, setModalidad] = useState<ModalidadTarjeta>(() => habilitadas[0] ?? "credito");
  // null = se usa la sugerencia por el prefijo del número.
  const [marcaElegida, setMarcaElegida] = useState<Marca | null>(null);
  // La marca se detecta por el número: el selector aparece sólo si no se reconoce o si la quiere cambiar.
  const [cambiarMarca, setCambiarMarca] = useState(false);
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
  // Al obtener el token se borra el número, y con él la marca detectada: las cuotas siguen con la marca
  // del cobro (no se re-consultan a mitad del pago) hasta que vuelva a tipear el número o la marca.
  const [marcaDelCobro, setMarcaDelCobro] = useState<Marca | null>(null);
  const marcaCuotas = marcaDelCobro ?? marca;

  /**
   * Cuotas: las opciones del pedido para la marca de la tarjeta (las de Payway son las mismas que las ids
   * canónicas del servidor). Sin respuesta del servidor queda lo que el pedido ya tiene congelado, que el
   * cobro acepta tal cual, más 1 pago para el débito.
   */
  const consultar = estado.fase !== "pendiente" && estado.fase !== "pagado";
  const cuotas = useOpcionesCuotas(pedidoId, { marca: modalidad === "credito" ? marcaCuotas : null }, consultar);
  const datosCuotas = cuotas.datos;
  const precioUnPago = datosCuotas?.precioUnPago ?? monto;
  const opcionesCuotas = useMemo(() => {
    if (datosCuotas && datosCuotas.opciones.length > 0) return opcionesCuotasPayway(datosCuotas.opciones);
    const respaldo = opcionesDeRespaldo({ cuotas: cuotasPedido, total: monto });
    return respaldo.some((o) => o.tipo === "un_pago") ? respaldo : [...opcionesDeRespaldo({ cuotas: null, total: monto }), ...respaldo];
  }, [datosCuotas, cuotasPedido, monto]);
  const [claveCuotas, setClaveCuotas] = useState<string | null>(null);
  // Si la elegida deja de ofrecerse (otra marca), vuelve a 1 pago y se avisa. Débito: siempre 1 pago.
  // Sin elegir todavía, arranca en lo que el pedido ya tiene congelado (un pedido retomado en N cuotas).
  const { opcion: eleccion, conSelector } = eleccionPayway({ modalidad, opciones: opcionesCuotas, clave: claveCuotas, cuotasPedido });
  const noDisponible = conSelector
    ? avisoCuotasNoDisponibles(opcionesCuotas, claveCuotas ?? claveDelPedido(cuotasPedido), datosCuotas?.marca ?? null)
    : null;

  useEffect(() => {
    onEleccionCuotas?.({ opcion: eleccion, precioUnPago });
  }, [eleccion, precioUnPago, onEleccionCuotas]);
  // Al salir del formulario (otro medio, pagado), el resumen vuelve al total del pedido.
  useEffect(() => () => onEleccionCuotas?.(null), [onEleccionCuotas]);
  // Con 6 dígitos ya se reconoce la marca: antes no se pregunta (con el número vacío confundía).
  const sinReconocer = normalizarPan(pan).replace(/\D/g, "").length >= 6 && !sugerida;
  const mostrarSelectorMarca = cambiarMarca || sinReconocer || marcaElegida !== null || Boolean(errores.marca);

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
    return e;
  }

  async function pagar(ev: React.FormEvent) {
    ev.preventDefault();
    if (estado.fase === "procesando" || config === null || config === "error") return;

    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) {
      // Foco al primer campo con error.
      const orden = ["pan", "venc", "cvv", "titular", "doc", "marca"] as const;
      const primero = orden.find((k) => e[k]);
      formRef.current?.querySelector<HTMLElement>(`[data-campo="${primero}"]`)?.focus();
      return;
    }

    const metodoPagoId = metodoPagoIdDe(marca, modalidad)!;
    setEstado({ fase: "procesando" });
    setMarcaDelCobro(marca);

    // Antes de tokenizar (el token es de un solo uso): el pedido queda en las cuotas de la opción (N sin
    // interés de la tienda; 1 para el pago único y el débito). Un 409/422 vuelve a pedir las opciones.
    const elegida = eleccion;
    const asegurado = await asegurarCuotasDelPedido({
      pedidoId,
      pagoMetodo,
      cuotas: elegida.pedidoCuotas,
      totalVisto: datosCuotas ? elegida.total : undefined,
      actual: { cuotas: cuotasPedido, total: monto },
    });
    if (!asegurado.ok) {
      cuotas.recargar();
      // Sin token no se cobró nada: se conserva lo tipeado.
      setEstado({ fase: "rechazado", mensaje: asegurado.error });
      return;
    }
    if (asegurado.cambio) onPedidoActualizado?.({ cuotas: asegurado.cuotas, total: asegurado.total });

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

    const r = await enviarCobro({ pedidoId, token: token.token, bin: token.bin, metodoPagoId, cuotas: elegida.cuotas });
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
          Cobramos {fmtPrecio(eleccion.total)} para el pedido {numero}.
        </p>
      </div>
    );
  }

  if (estado.fase === "pendiente") {
    return (
      <PagoEnConfirmacion
        pedidoId={pedidoId}
        onAgotado={onConfirmacionAgotada}
        onPagado={() => {
          setEstado({ fase: "pagado" });
          onPagado();
        }}
        onRechazado={(mensaje, cobrable) => {
          setEstado({ fase: "rechazado", mensaje, noCobrable: !cobrable });
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

  // Pedido que ya no se puede pagar (vencido o cancelado mientras se pagaba): sólo el aviso. Con el
  // formulario a la vista el comprador reintentaba y el servidor lo rechazaba una y otra vez.
  if (estado.fase === "rechazado" && estado.noCobrable) {
    return (
      <Alert tone="danger" title="No se pudo completar el pago">
        {estado.mensaje}
      </Alert>
    );
  }

  const etiquetaMarca = MARCAS.find((m) => m.id === sugerida)?.etiqueta;
  const textoBoton = textoBotonPagar(eleccion);

  const campos = (
    <div className="flex flex-col gap-4">
      <Field label="Número de tarjeta" error={errores.pan}>
        <Input
          data-campo="pan"
          name="cc-number"
          autoComplete="cc-number"
          inputMode="numeric"
          placeholder="0000 0000 0000 0000"
          value={pan}
          onChange={(e) => {
            setPan(agruparPan(e.target.value));
            setMarcaDelCobro(null);
          }}
          disabled={procesando}
        />
      </Field>
      {!mostrarSelectorMarca && etiquetaMarca && (
        <p className="-mt-2 flex items-center gap-2 text-sm text-muted">
          Tarjeta {etiquetaMarca}.
          <Button type="button" variant="link" size="sm" onClick={() => setCambiarMarca(true)} disabled={procesando}>
            Cambiar marca
          </Button>
        </p>
      )}
      {mostrarSelectorMarca && (
        <Field label="Marca" hint={sugerida && !marcaElegida ? "Detectada por el número; puede cambiarla." : undefined} error={errores.marca}>
          <Select
            options={MARCAS.map((m) => ({ label: m.etiqueta, value: m.id }))}
            value={marca ?? ""}
            onValueChange={(v) => {
              setMarcaElegida(v as Marca);
              setMarcaDelCobro(null);
            }}
            placeholder="Seleccionar marca"
            disabled={procesando}
          />
        </Field>
      )}

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

      {conSelector && (
        <SelectorCuotas
          opciones={opcionesCuotas}
          elegida={eleccion}
          onElegir={setClaveCuotas}
          marca={datosCuotas?.marca ?? null}
          restringidas={datosCuotas?.restringidas ?? []}
          procesador={PROCESADOR}
          noDisponible={noDisponible}
          deshabilitado={procesando}
        />
      )}

      <Button type="submit" size="lg" loading={procesando} disabled={procesando || config === null}>
        <IconoCandado />
        {procesando ? (
          "Procesando su pago…"
        ) : (
          <>
            {/* En el celular, la versión corta ("Pagar 6 × $X") para que entre en una línea. */}
            <span className="sm:hidden">{textoBoton.corto}</span>
            <span className="hidden sm:inline">{textoBoton.largo}</span>
          </>
        )}
      </Button>

      {procesando && (
        <p role="status" className="text-sm text-muted">
          Estamos procesando su pago. Puede demorar hasta un minuto; no cierre ni recargue esta página.
        </p>
      )}
    </div>
  );

  const todas: RadioOption[] = [
    {
      value: "credito",
      label: "Tarjeta de crédito",
      description: "Visa, Mastercard, American Express, Cabal, Naranja y Diners",
      icon: <IconoTarjeta />,
      content: campos,
      disabled: procesando && modalidad !== "credito",
    },
    {
      value: "debito",
      label: "Tarjeta de débito",
      description: "Visa, Mastercard, Maestro y Cabal de débito",
      icon: <IconoTarjetaDebito />,
      content: campos,
      disabled: procesando && modalidad !== "debito",
    },
  ];
  const opciones = todas.filter((o) => habilitadas.includes(o.value as ModalidadTarjeta));

  return (
    <form ref={formRef} onSubmit={pagar} noValidate autoComplete="on" className="flex flex-col gap-4">
      {estado.fase === "rechazado" && (
        <Alert tone="danger" title="No se pudo completar el pago">
          {estado.mensaje}
        </Alert>
      )}

      <TituloComoPagar />
      <RadioGroup
        legend="¿Cómo quiere pagar?"
        hideLegend
        options={opciones}
        value={modalidad}
        onValueChange={(v) => setModalidad(v as ModalidadTarjeta)}
      />

      <AvisoProcesador>Payway procesa el pago. Los datos de su tarjeta van directo a Payway y no se guardan en nuestro sitio.</AvisoProcesador>
    </form>
  );
}
