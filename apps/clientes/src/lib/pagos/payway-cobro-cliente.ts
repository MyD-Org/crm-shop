/**
 * Lado navegador del cobro con Payway: arma el cuerpo de `POST /api/pagos/payway` y traduce la
 * respuesta a lo que muestra el formulario. Módulo puro (el `fetch` se inyecta).
 *
 * Al servidor viajan sólo el token, el BIN, el id de medio de pago y las cuotas. NUNCA el número de
 * tarjeta, el código de seguridad ni el monto (el monto sale del pedido, en el servidor).
 */

export interface ParamsCobro {
  pedidoId: string;
  token: string;
  bin: string;
  metodoPagoId: number;
  cuotas: number;
}

export function cuerpoCobro(p: ParamsCobro) {
  return {
    pedidoId: p.pedidoId,
    medio: "tarjeta" as const,
    token: p.token,
    bin: p.bin,
    metodoPagoId: String(p.metodoPagoId),
    cuotas: p.cuotas,
  };
}

export type ResultadoCobro =
  | { fase: "pagado" }
  | { fase: "pendiente" }
  | { fase: "rechazado"; mensaje: string; reintentable: boolean };

interface RespuestaPago {
  estado?: "pagado" | "pendiente" | "fallido";
  mensaje?: string;
  reintentable?: boolean;
  motivo?: string;
  error?: string;
}

export async function enviarCobro(p: ParamsCobro, doFetch: typeof fetch = fetch): Promise<ResultadoCobro> {
  let res: Response;
  try {
    res = await doFetch("/api/pagos/payway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoCobro(p)),
    });
  } catch {
    // El token ya viajó: no sabemos si el cobro llegó a hacerse. No se invita a pagar de nuevo; el
    // servidor y la conciliación lo resuelven y el comprador recibe el aviso.
    return { fase: "pendiente" };
  }

  const json = (await res.json().catch(() => ({}))) as RespuestaPago;

  if (!res.ok) {
    return {
      fase: "rechazado",
      mensaje: json.error ?? "No pudimos procesar el pago. Inténtelo de nuevo en un momento.",
      // Con un pago ya en curso, otro intento sólo confunde.
      reintentable: json.motivo !== "pago_en_curso",
    };
  }
  if (json.estado === "pagado") return { fase: "pagado" };
  if (json.estado === "fallido") {
    return {
      fase: "rechazado",
      mensaje: json.mensaje ?? "No pudimos procesar el pago. Inténtelo de nuevo o elija otro medio de pago.",
      reintentable: json.reintentable ?? false,
    };
  }
  return { fase: "pendiente" };
}
