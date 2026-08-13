"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Payment, StatusScreen, initMercadoPago } from "@mercadopago/sdk-react";
import { Button } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";

/**
 * Cobro con tarjeta dentro del sitio, con Checkout Bricks.
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

type Estado =
  | { fase: "cargando" }
  | { fase: "formulario" }
  | { fase: "procesando" }
  | { fase: "pagado" }
  | { fase: "pendiente"; detalle?: string }
  | { fase: "desafio3ds"; referencia: string; url: string; creq: string }
  | { fase: "rechazado"; mensaje: string; reintentable: boolean };

interface Props {
  pedidoId: string;
  numero: string;
  monto: number;
  emailComprador?: string;
  /** Se llama cuando el cobro quedó confirmado. */
  onPagado: () => void;
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
  onPagado,
}: Props) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);

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
   * `mercadoPago: "all"` habilita dinero en cuenta dentro del mismo brick: MP
   * abre un popup para que el comprador se loguee y elija saldo, y devuelve
   * `payment_method_id: "account_money"` sin token. La doc §6 hablaba de un
   * Wallet Brick separado con aviso previo, pero el propio card de MP dentro
   * del Payment Brick ya cumple ese rol (logo grande, texto de MP) y ahorra
   * mantener dos bricks distintos. El aviso literal está debajo del componente.
   */
  const customization = useMemo(
    () =>
      ({
        paymentMethods: {
          creditCard: "all",
          debitCard: "all",
          mercadoPago: "all",
        },
        visual: { style: { theme: "default" } },
      }) as const,
    [],
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
      payment_type_id?: string;
    };

    /**
     * Detección del medio del lado del cliente: MP marca dinero en cuenta con
     * `payment_method_id === "account_money"` (y `payment_type_id === "account_money"`).
     * El server igual re-decide con lo que le llega — el cliente puede mentir —
     * pero mandar el medio correcto acá evita que un dinero en cuenta se
     * intente cobrar como tarjeta y falle por token faltante.
     */
    const esCuentaMp =
      datos?.payment_method_id === "account_money" ||
      datos?.payment_type_id === "account_money";

    try {
      const res = await fetch("/api/pagos/mercadopago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedidoId,
          medio: esCuentaMp ? "cuenta_mp" : "tarjeta",
          token: datos?.token,
          cuotas: datos?.installments,
          metodoPagoId: datos?.payment_method_id,
        }),
      });

      const json = (await res.json()) as RespuestaPago;

      if (!res.ok) {
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
        setEstado({
          fase: "rechazado",
          mensaje: json.mensaje ?? "No pudimos procesar el pago.",
          reintentable: json.reintentable ?? false,
        });
        return;
      }

      setEstado({ fase: "pendiente" });
    } catch {
      setEstado({
        fase: "rechazado",
        mensaje: "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.",
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

  const onSubmit = useCallback(
    async ({ formData }: { formData: unknown }) => {
      await enviarRef.current(formData);
    },
    [],
  );

  if (faltaKey) {
    return (
      <p className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        El pago con tarjeta no está configurado. Elegí transferencia o escribinos.
      </p>
    );
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
  if (estado.fase === "desafio3ds") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-3 text-sm text-muted">
          Tu banco necesita validar esta compra. Completá la verificación acá abajo
          — tenés unos minutos antes de que venza.
        </p>
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
      </div>
    );
  }

  // ------------------------------------------------------------- pendiente
  if (estado.fase === "pendiente") {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-bold text-text">Estamos confirmando tu pago</p>
        <p className="mt-1 text-sm text-muted">
          Mercado Pago todavía lo está procesando. Te avisamos apenas se acredite;
          no hace falta que pagues de nuevo.
        </p>
      </div>
    );
  }

  return (
    <div>
      {estado.fase === "rechazado" && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4">
          <p className="text-sm font-semibold text-danger">No se pudo completar el pago</p>
          <p className="mt-1 text-sm text-text">{estado.mensaje}</p>
          {estado.reintentable && (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => {
                // Remontar el brick: el token de MP es de un solo uso, así que
                // reintentar con el mismo formulario fallaría siempre.
                setIntento((n) => n + 1);
                setEstado({ fase: "formulario" });
              }}
            >
              Probar de nuevo
            </Button>
          )}
        </div>
      )}

      <Payment
        key={intento}
        initialization={initialization}
        customization={customization}
        onSubmit={onSubmit}
        onReady={() => setEstado((e) => (e.fase === "cargando" ? { fase: "formulario" } : e))}
        onError={(error) => {
          console.error("[brick mp]", error);
          setEstado({
            fase: "rechazado",
            mensaje: "Hubo un problema con el formulario de pago. Recargá la página.",
            reintentable: false,
          });
        }}
      />

      {/*
        Aviso previo de doc §6: "sin redirección" es literal para tarjeta, pero
        con dinero en cuenta MP abre una ventana para iniciar sesión. Anticiparlo
        evita que el comprador crea que perdió el formulario.
      */}
      <p className="mt-3 text-xs text-muted">
        Si pagás con dinero en cuenta de Mercado Pago, se abrirá una ventana
        para que inicies sesión.
      </p>
    </div>
  );
}
