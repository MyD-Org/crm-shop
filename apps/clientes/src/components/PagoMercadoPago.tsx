"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CardPayment, StatusScreen, initMercadoPago } from "@mercadopago/sdk-react";
import { Button, RadioGroup, Spinner, type RadioOption } from "@myd-org/ui";
import { PagoEnConfirmacion } from "@/components/PagoEnConfirmacion";
import { fmtPrecio } from "@/lib/format";
import { customizacionBrick, textoCuotas, type CustomizacionSdk, type TipoTarjeta } from "./pago-brick";
import { AvisoProcesador } from "./AvisoProcesador";
import { IconoBilletera, IconoCandado, IconoTarjeta, IconoTarjetaDebito, TituloComoPagar } from "./PagoIconos";
import { PagoCuentaMercadoPago } from "./PagoCuentaMercadoPago";
import { TarjetasAceptadasModal } from "./TarjetasAceptadasModal";
import { alEstarListo, alFallarBrick, alVencerPlazo, iniciarPlazoCarga } from "./pago-mp-carga";
import { AvisoFormularioNoCargo, AvisoPagoRechazado, AvisoSinConfigurar } from "./PagoMercadoPagoAvisos";

/**
 * Cobro con Mercado Pago: "¿Cómo quiere pagar?" con tarjeta de crédito, de débito o la cuenta de
 * Mercado Pago (`RadioGroup` del DS). Cada opción muestra lo suyo adentro: el formulario de tarjeta
 * (Card Payment Brick) o el botón "Ir a Mercado Pago".
 *
 * Los datos de la tarjeta viven en iframes de Mercado Pago y nunca tocan
 * nuestro código: acá solo llega un token de un solo uso. Eso es lo que nos
 * deja en el nivel más liviano de PCI.
 *
 * El monto que se muestra es informativo. El que se cobra sale del pedido
 * persistido en el servidor — ver /api/pagos/mercadopago.
 */

let iniciado = false;

function inicializar() {
  if (iniciado) return;
  const key = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
  if (!key) return;
  // `locale` acá y no en cada brick: si no, los textos salen en portugués.
  initMercadoPago(key, { locale: "es-AR" });
  iniciado = true;
}

type Opcion = TipoTarjeta | "cuenta";

type Estado =
  | { fase: "cargando" }
  | { fase: "error_formulario" }
  | { fase: "formulario" }
  | { fase: "procesando" }
  | { fase: "pagado" }
  | { fase: "pendiente"; detalle?: string }
  | { fase: "desafio3ds"; referencia: string; url: string; creq: string }
  /** `noCobrable`: el pedido ya no se puede pagar (vencido o cancelado): sin formulario. */
  | { fase: "rechazado"; mensaje: string; reintentable: boolean; noCobrable?: boolean };

interface Props {
  pedidoId: string;
  numero: string;
  monto: number;
  emailComprador?: string;
  /**
   * Máximo de cuotas congelado en el pedido (sólo con el flag `cuotas`). Sin
   * valor, el Brick ofrece lo que devuelva Mercado Pago, como antes. Es
   * constante durante la vida del pedido: no reinicia el Brick.
   */
  maxCuotas?: number;
  /** Se llama cuando el cobro quedó confirmado. */
  onPagado: () => void;
  /** Se llama cuando el procesador todavía no confirmó el cobro (queda "Estamos confirmando"). */
  onPendiente?: () => void;
  /** Mientras se confirmaba, el procesador lo rechazó: vuelve el formulario para pagar este mismo pedido. */
  onRechazado?: () => void;
  /** El pedido ya tiene un cobro en curso (se retomó): arranca en "Estamos confirmando su pago". */
  iniciarEnConfirmacion?: boolean;
  /** `payment_id` con el que volvió de Mercado Pago (cuenta de Mercado Pago): se consulta ese pago. */
  pagoMercadoPagoId?: string;
  /**
   * Hay un cobro en vuelo (enviando o en la validación del banco): el checkout oculta "Cambiar medio de
   * pago" y "Volver al carrito", que desmontarían este formulario a mitad del cobro.
   */
  onCobroEnCurso?: (enCurso: boolean) => void;
  /** "Estamos confirmando" se agotó sin resultado: el checkout vuelve a ofrecer otras salidas. */
  onConfirmacionAgotada?: () => void;
}

interface RespuestaPago {
  estado?: "pagado" | "pendiente" | "fallido";
  mensaje?: string;
  reintentable?: boolean;
  referencia?: string;
  desafio?: { externalResourceUrl: string; creq: string };
  error?: string;
}

export function PagoMercadoPago({
  pedidoId,
  numero,
  monto,
  emailComprador,
  maxCuotas,
  onPagado,
  onPendiente,
  onRechazado,
  iniciarEnConfirmacion = false,
  pagoMercadoPagoId,
  onCobroEnCurso,
  onConfirmacionAgotada,
}: Props) {
  const [estado, setEstado] = useState<Estado>(iniciarEnConfirmacion ? { fase: "pendiente" } : { fase: "cargando" });
  const [intento, setIntento] = useState(0);
  const cobroEnCurso = estado.fase === "procesando" || estado.fase === "desafio3ds";
  useEffect(() => {
    onCobroEnCurso?.(cobroEnCurso);
  }, [cobroEnCurso, onCobroEnCurso]);
  const [opcion, setOpcion] = useState<Opcion>("credito");
  /** El débito es siempre un pago: con cuotas congeladas no se ofrece. */
  const debitoDisponible = !(maxCuotas !== undefined && maxCuotas > 1);

  useEffect(() => {
    inicializar();
  }, []);

  const faltaKey = !process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;

  /**
   * `initialization` y `customization` DEBEN tener identidad estable.
   *
   * Eran objetos literales, o sea nuevos en cada render. Al apretar "Pagar" el
   * estado pasa a "procesando", React vuelve a renderizar, el SDK ve props
   * distintas y **reinicia el brick**: el comprador volvía a la pantalla de
   * elegir medio de pago, con los datos de la tarjeta perdidos, y recién
   * después le aparecía el error. Parecía que el pago no se había enviado.
   *
   * El remontado a propósito —cuando conviene reintentar— se sigue haciendo con
   * `key={intento}`, que es explícito y controlado por nosotros.
   */
  const initialization = useMemo(
    () => ({
      amount: monto,
      payer: emailComprador ? { email: emailComprador } : undefined,
    }),
    [monto, emailComprador],
  );

  /**
   * La tarjeta elegida, con las cuotas del pedido congelado (ver `pago-brick.ts`). La identidad sólo
   * cambia si cambia la tarjeta, las cuotas o el monto (test de regresión #21).
   */
  const tipoTarjeta: TipoTarjeta = opcion === "debito" ? "debito" : "credito";
  const customization = useMemo(
    () => customizacionBrick(tipoTarjeta, maxCuotas) as CustomizacionSdk,
    [tipoTarjeta, maxCuotas],
  );

  /**
   * El brick espera una promesa: mientras no se resuelva, mantiene el botón en
   * "procesando" y bloquea un segundo envío. Por eso el `await` del fetch va
   * adentro y no se dispara en background.
   */
  async function enviar(formData: unknown) {
    setEstado({ fase: "procesando" });

    const datos = formData as {
      token?: string;
      installments?: number;
      payment_method_id?: string;
    };

    try {
      const res = await fetch("/api/pagos/mercadopago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoId,
          medio: "tarjeta",
          token: datos?.token,
          cuotas: datos?.installments,
          metodoPagoId: datos?.payment_method_id,
        }),
      });

      const json = (await res.json()) as RespuestaPago;

      if (!res.ok) {
        setIntento((n) => n + 1);
        setEstado({
          fase: "rechazado",
          mensaje: json?.error ?? "No pudimos procesar el pago.",
          reintentable: true,
        });
        return;
      }

      if (json.desafio && json.referencia) {
        // 3DS: el banco quiere validar al titular. No es un rechazo.
        setEstado({
          fase: "desafio3ds",
          referencia: json.referencia,
          url: json.desafio.externalResourceUrl,
          creq: json.desafio.creq,
        });
        return;
      }

      if (json.estado === "pagado") {
        setEstado({ fase: "pagado" });
        onPagado();
        return;
      }

      if (json.estado === "fallido") {
        setIntento((n) => n + 1);
        setEstado({
          fase: "rechazado",
          mensaje: json.mensaje ?? "No pudimos procesar el pago.",
          reintentable: json.reintentable ?? false,
        });
        return;
      }

      setEstado({ fase: "pendiente" });
      onPendiente?.();
    } catch {
      setIntento((n) => n + 1);
      setEstado({
        fase: "rechazado",
        mensaje: "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.",
        reintentable: true,
      });
    }
  }

  /**
   * `onSubmit` también tiene que ser estable, por el mismo motivo que las props
   * de arriba. Se guarda `enviar` en una ref en vez de memoizarla: depende de
   * `onPagado`, que el padre pasa como función nueva en cada render, así que un
   * `useCallback` volvería a cambiar de identidad y no resolvería nada.
   */
  const enviarRef = useRef(enviar);
  // La asignación va en un efecto y no en el render: React prohíbe tocar refs
  // durante el render. Corre después de cada uno, y `onSubmit` solo se invoca
  // por interacción del comprador — siempre posterior.
  useEffect(() => {
    enviarRef.current = enviar;
  });

  // El Card Payment Brick llama `onSubmit(formData)` directo (el Payment Brick lo envolvía).
  const onSubmit = useCallback(async (formData: unknown) => {
    await enviarRef.current(formData);
  }, []);

  /**
   * `onReady` y `onError` también tienen que ser estables. El `useEffect` del
   * SDK depende de `[initialization, customization, onReady, onError, onSubmit,
   * onBinChange]` y, cuando cambia cualquiera, DESMONTA y vuelve a crear el
   * brick.
   *
   * Eran funciones inline. Al apretar "Pagar" el estado pasa a "procesando", el
   * componente se re-renderiza, estas dos cambian de identidad y el comprador
   * vuelve a la pantalla de elegir medio de pago mientras su pago se procesa.
   * El arreglo anterior estabilizó las otras tres props y dejó estas dos.
   *
   * Solo usan `setEstado`, que React garantiza estable: sin dependencias.
   */
  const onReady = useCallback(() => {
    // El SDK puede recuperarse de un error de carga. Esto nunca borra un
    // rechazo real ni modifica un pago que ya se está procesando.
    setEstado(alEstarListo);
  }, []);

  /**
   * El SDK distingue `critical` de `non_critical`: sólo los críticos dejan el
   * formulario inutilizable y piden "Reintentar". Los no críticos (p. ej. datos de
   * tarjeta inválidos) ya los muestra el Brick en sus campos: acá sólo se loguean.
   */
  const onError = useCallback((error: unknown) => {
    console.error("[brick mp]", error);
    setEstado((e) => alFallarBrick(e, error));
  }, []);

  /**
   * Tiempo límite de carga: si el Brick montado no avisa `onReady` en
   * `PLAZO_CARGA_MS`, se pasa a `error_formulario` con "Reintentar" (ver el plazo
   * en `pago-mp-carga.ts`). Corre sólo mientras se está cargando.
   * Se limpia al llegar `onReady`, al fallar, al desmontar y al reintentar, y cada
   * intento (`intento`) arranca su propio plazo.
   */
  const cargandoConBrick = !faltaKey && opcion !== "cuenta" && estado.fase === "cargando";
  useEffect(() => {
    if (!cargandoConBrick) return;
    return iniciarPlazoCarga(() => setEstado(alVencerPlazo));
  }, [cargandoConBrick, intento]);

  /** Remonta el Brick (`key`) y vuelve a cargar: el token de MP es de un solo uso. */
  function reintentar() {
    setIntento((n) => n + 1);
    setEstado({ fase: "cargando" });
  }

  /**
   * "Pagar $ X" es nuestro `Button` (el Brick va con `hidePaymentButton`): le pide al Brick los datos
   * de la tarjeta ya tokenizados. Si falta o está mal un campo, el Brick lo marca y no devuelve nada.
   */
  async function pagarConTarjeta() {
    if (estado.fase === "procesando") return;
    const controlador = (window as { cardPaymentBrickController?: { getFormData: () => Promise<unknown> } })
      .cardPaymentBrickController;
    if (!controlador) return;
    let datos: unknown;
    try {
      datos = await controlador.getFormData();
    } catch {
      return;
    }
    if (datos) await enviarRef.current(datos);
  }

  /** Otra opción: una tarjeta monta su Brick de cero; la cuenta no tiene nada que cargar. */
  function elegir(nueva: Opcion) {
    if (nueva === opcion || estado.fase === "procesando") return;
    setOpcion(nueva);
    if (nueva === "cuenta") {
      setEstado({ fase: "formulario" });
    } else {
      setIntento((n) => n + 1);
      setEstado({ fase: "cargando" });
    }
  }

  if (faltaKey) {
    return <AvisoSinConfigurar />;
  }

  // ------------------------------------------------------------------ pagado
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

  // ---------------------------------------------------------------- 3DS
  // La validación del banco la explica la propia pantalla de Mercado Pago: sin texto ni recuadro
  // nuestro alrededor (se desarmaba). Debajo, sin mostrar nada, se consulta el resultado: al aprobarse
  // o rechazarse la pantalla avanza sola (antes quedaba la de Mercado Pago, sin volver al checkout).
  if (estado.fase === "desafio3ds") {
    return (
      <div className="w-full min-w-0 overflow-hidden">
        <StatusScreen
          initialization={{
            paymentId: estado.referencia,
            additionalInfo: {
              externalResourceURL: estado.url,
              creq: estado.creq,
            },
          }}
          onReady={() => {}}
        />
        <PagoEnConfirmacion
          pedidoId={pedidoId}
          silencioso
          onPagado={() => {
            setEstado({ fase: "pagado" });
            onPagado();
          }}
          onRechazado={(mensaje, cobrable) => {
            setIntento((n) => n + 1);
            setEstado({ fase: "rechazado", mensaje, reintentable: true, noCobrable: !cobrable });
            onRechazado?.();
          }}
        />
      </div>
    );
  }

  // ------------------------------------------------------------- pendiente
  if (estado.fase === "pendiente") {
    return (
      <PagoEnConfirmacion
        pedidoId={pedidoId}
        pagoMercadoPagoId={pagoMercadoPagoId}
        onAgotado={onConfirmacionAgotada}
        onPagado={() => {
          setEstado({ fase: "pagado" });
          onPagado();
        }}
        onRechazado={(mensaje, cobrable) => {
          // Se vuelve al formulario sobre el mismo pedido: remontar el brick (el token es de un solo uso).
          // Si el pedido ya no se puede pagar (vencido, cancelado), sin "Probar de nuevo".
          setIntento((n) => n + 1);
          setEstado({ fase: "rechazado", mensaje, reintentable: true, noCobrable: !cobrable });
          onRechazado?.();
        }}
      />
    );
  }

  const procesando = estado.fase === "procesando";

  // Pedido que ya no se puede pagar (vencido o cancelado mientras se pagaba): sólo el aviso. Con el
  // formulario a la vista el comprador reintentaba y el servidor lo rechazaba una y otra vez.
  if (estado.fase === "rechazado" && estado.noCobrable) {
    return <AvisoPagoRechazado mensaje={estado.mensaje} />;
  }

  const formularioBrick = (
    <div className="relative min-h-48" aria-busy={estado.fase === "cargando"}>
      {estado.fase === "cargando" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface">
          <Spinner label="Cargando el formulario de pago" />
          <p className="text-sm text-muted">Cargando el formulario de pago…</p>
        </div>
      )}
      {/* Sigue montado para que el SDK pueda terminar de cargar. Sus estados
          intermedios no son un error ni deben pedir que se cambie de medio. */}
      <div aria-hidden={estado.fase === "cargando"} className={estado.fase === "cargando" ? "invisible" : undefined}>
        <CardPayment
          key={`${tipoTarjeta}-${intento}`}
          initialization={initialization}
          customization={customization}
          onSubmit={onSubmit}
          onReady={onReady}
          onError={onError}
        />
      </div>
      {estado.fase !== "cargando" && (
        <div className="mt-4 flex flex-col">
          <Button size="lg" onClick={pagarConTarjeta} loading={procesando} disabled={procesando}>
            <IconoCandado />
            {procesando ? "Procesando su pago…" : `Pagar ${fmtPrecio(monto)}`}
          </Button>
        </div>
      )}
    </div>
  );

  const formularioTarjeta = (
    <div className="flex flex-col gap-3">
      <TarjetasAceptadasModal tipo={tipoTarjeta} />
      {formularioBrick}
    </div>
  );

  const opciones: RadioOption[] = [
    {
      value: "credito",
      label: "Tarjeta de crédito",
      description: "Visa, Mastercard, American Express y más",
      icon: <IconoTarjeta />,
      ...(maxCuotas !== undefined
        ? { badge: { label: textoCuotas(maxCuotas), tone: maxCuotas > 1 ? ("success" as const) : ("neutral" as const) } }
        : {}),
      content: formularioTarjeta,
      disabled: procesando && opcion !== "credito",
    },
    {
      value: "debito",
      label: "Tarjeta de débito",
      description: debitoDisponible ? "Visa Débito, Maestro y más" : "Para pagar con débito, pase su compra a un pago.",
      icon: <IconoTarjetaDebito />,
      ...(debitoDisponible ? {} : { badge: { label: "Sólo en un pago" } }),
      content: formularioTarjeta,
      disabled: !debitoDisponible || (procesando && opcion !== "debito"),
    },
    {
      value: "cuenta",
      label: "Cuenta de Mercado Pago",
      description: "Dinero disponible o tarjetas guardadas en su cuenta",
      icon: <IconoBilletera />,
      content: <PagoCuentaMercadoPago pedidoId={pedidoId} cuotas={maxCuotas} />,
      disabled: procesando,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {estado.fase === "error_formulario" && <AvisoFormularioNoCargo onReintentar={reintentar} />}
      {estado.fase === "rechazado" && (
<AvisoPagoRechazado mensaje={estado.mensaje} />
      )}

      <TituloComoPagar />
      <RadioGroup
        legend="¿Cómo quiere pagar?"
        hideLegend
        options={opciones}
        value={opcion}
        onValueChange={(v) => elegir(v as Opcion)}
      />

      <AvisoProcesador>Mercado Pago procesa el pago. Los datos de su tarjeta no pasan por nuestro sitio.</AvisoProcesador>
    </div>
  );
}
