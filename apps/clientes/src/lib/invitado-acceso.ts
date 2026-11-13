/**
 * Quién es el solicitante de un pedido concreto: una cuenta (Clerk o cliente vinculado) o un
 * invitado con el token de compra de ESE pedido (change `compra-como-invitado`). SOLO servidor.
 *
 * `identidadActual()` no cambia: sigue devolviendo sólo Clerk/CRM. El invitado se resuelve acá, por
 * request y por pedido, y se enchufa en los endpoints del pedido (rebanada S2a). El token viaja en el
 * header `X-Pedido-Token` (nunca en el body ni en una cookie) y se verifica sin almacén.
 *
 * Reglas:
 *  - Sesión Clerk/CRM > token (X4): con sesión el token del invitado se ignora y ni se mira el flag.
 *  - Sin sesión sólo vale con el flag `compra-invitado` encendido, un token de propósito `compra`
 *    firmado para este tenant, vigente y del MISMO pedido que se está pidiendo. El link `pago` del
 *    mail NO se acepta en la API (la página `/pagar/[token]` lo canjea por un token `compra`).
 *  - Cualquier fallo salvo el vencimiento responde igual (`sin_credencial`): no se distingue un
 *    pedido ajeno, uno inexistente ni un token alterado. El vencimiento sí se informa, para que la
 *    ruta lleve al invitado al link «Pagar su pedido» de su mail.
 *  - Que el token alcance NO es que el pedido sea suyo: la consulta lo confirma con la tercera llave
 *    de `esDeSuDueno` (`invitadoOrderId`: pedido de invitado, sin cuenta, de este tenant).
 *  - Límite por IP y por pedido, nunca por token ni por cookie: rotar de navegador no lo evade.
 */
import { identidadActual, type Identidad } from "@/lib/auth";
import { compraInvitadoHabilitada } from "@/lib/compra-invitado-flag";
import { ipDelRequest } from "@/lib/ip-cliente";
import { verificarToken } from "@/lib/pedido-token";
import type { DuenoPedidos } from "@/lib/pedidos";
import { permitirAsync } from "@/lib/rate-limit";

export const HEADER_TOKEN_PEDIDO = "x-pedido-token";

/** Por ventana de 5 min (el sondeo del pago consulta cada 5-15 s): holgado para quien paga bien, con CGNAT. */
const VENTANA_MS = 5 * 60_000;
const MAX_POR_IP = 240;
const MAX_POR_PEDIDO = 240;

export type PrincipalPedido =
  | { tipo: "cuenta"; dueno: DuenoPedidos; clave: string; email?: string; identidad: Identidad }
  | { tipo: "invitado"; dueno: DuenoPedidos; clave: string; orderId: string };

export type ResultadoPrincipal =
  | { ok: true; principal: PrincipalPedido }
  | { ok: false; motivo: "sin_credencial" | "token_vencido" | "limite" };

const SIN_CREDENCIAL = { ok: false, motivo: "sin_credencial" } as const;

export async function principalDelPedido(req: Request, pedidoId: string | null): Promise<ResultadoPrincipal> {
  const identidad = await identidadActual();
  if (identidad.clerkUserId || identidad.cliente) {
    return {
      ok: true,
      principal: {
        tipo: "cuenta",
        dueno: { clerkUserId: identidad.clerkUserId, clienteCodigo: identidad.cliente?.codigocliente },
        clave: (identidad.clerkUserId ?? identidad.cliente?.codigocliente) as string,
        email: identidad.email,
        identidad,
      },
    };
  }

  if (!pedidoId) return SIN_CREDENCIAL;
  if (!(await compraInvitadoHabilitada())) return SIN_CREDENCIAL;

  const token = req.headers.get(HEADER_TOKEN_PEDIDO);
  if (!token) return SIN_CREDENCIAL;

  const r = verificarToken(token, "compra");
  if (!r.ok) {
    return r.motivo === "vencido" ? { ok: false, motivo: "token_vencido" } : SIN_CREDENCIAL;
  }
  if (r.orderId !== pedidoId) return SIN_CREDENCIAL;

  const clave = `inv:ip:${ipDelRequest(req) ?? "desconocida"}`;
  if (!(await permitirAsync(clave, MAX_POR_IP, VENTANA_MS))) return { ok: false, motivo: "limite" };
  if (!(await permitirAsync(`inv:ped:${r.orderId}`, MAX_POR_PEDIDO, VENTANA_MS))) return { ok: false, motivo: "limite" };

  return {
    ok: true,
    principal: { tipo: "invitado", dueno: { clerkUserId: null, invitadoOrderId: r.orderId }, clave, orderId: r.orderId },
  };
}
