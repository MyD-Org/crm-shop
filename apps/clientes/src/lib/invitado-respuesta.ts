/**
 * Respuestas HTTP de la autorización por pedido (change `compra-como-invitado`, S2a). SOLO servidor.
 *
 * Las rutas del pedido llaman a `resolverPrincipal` en lugar de `identidadActual()`: devuelve el
 * principal (cuenta o invitado con su token) o la respuesta de error lista para devolver. El error
 * sin credencial es el mismo 401 `{ error: "No autorizado" }` de siempre, para que un invitado sin
 * token, con un token alterado, de otro pedido o de otro tenant vea exactamente lo mismo que un
 * anónimo con el flag apagado (no hay señal para enumerar pedidos).
 */
import { NextResponse } from "next/server";
import { principalDelPedido, type PrincipalPedido } from "./invitado-acceso";
import { MENSAJES_INVITADO } from "./invitado-mensajes";

export type ResolucionPrincipal = { principal: PrincipalPedido } | { respuesta: NextResponse };

export async function resolverPrincipal(
  req: Request,
  pedidoId: string | null,
  /** Headers de las respuestas de error (p. ej. `Cache-Control: no-store` en las rutas de pago). */
  headers?: HeadersInit,
): Promise<ResolucionPrincipal> {
  const r = await principalDelPedido(req, pedidoId);
  if (r.ok) return { principal: r.principal };
  if (r.motivo === "token_vencido") {
    return {
      respuesta: NextResponse.json(
        { error: MENSAJES_INVITADO.tokenVencido, motivo: "token_vencido" },
        { status: 401, headers },
      ),
    };
  }
  if (r.motivo === "limite") {
    return {
      respuesta: NextResponse.json(
        { error: MENSAJES_INVITADO.limiteConsultas },
        { status: 429, headers: { ...headers, "Retry-After": "60" } },
      ),
    };
  }
  return { respuesta: NextResponse.json({ error: "No autorizado" }, { status: 401, headers }) };
}

/** El invitado no cancela (A3): 403 con el texto que lo manda al local. */
export function rechazoInvitadoNoCancela(): NextResponse {
  return NextResponse.json(
    { error: MENSAJES_INVITADO.sinCancelar, motivo: "invitado_sin_cancelar" },
    { status: 403 },
  );
}

/**
 * Quién es el solicitante para las claves de rate limit existentes: `clerk:<id>` / `cliente:<código>`
 * (iguales a las de antes) o `inv:ip:<ip>` para el invitado (nunca por token ni cookie).
 */
export function quienDe(p: PrincipalPedido): string {
  if (p.tipo === "invitado") return p.clave;
  const { clerkUserId, cliente } = p.identidad;
  return clerkUserId ? `clerk:${clerkUserId}` : `cliente:${cliente!.codigocliente}`;
}

/** El cliente vinculado (cuenta corriente) de un principal de cuenta; el invitado nunca lo tiene. */
export function clienteDe(p: PrincipalPedido) {
  return p.tipo === "cuenta" ? p.identidad.cliente : null;
}
