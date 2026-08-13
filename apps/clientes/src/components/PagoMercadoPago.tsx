"use client";

import { useEffect, useState } from "react";
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
        initialization={{
          amount: monto,
          payer: emailComprador ? { email: emailComprador } : undefined,
        }}
        customization={{
          paymentMethods: { creditCard: "all", debitCard: "all" },
          visual: { style: { theme: "default" } },
        }}
        onSubmit={async ({ formData }) => {
          await enviar(formData);
        }}
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
    </div>
  );
}
