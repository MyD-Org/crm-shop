/**
 * Flag `compra-invitado` (change `compra-como-invitado`). Se lee sólo en el server, por request, y
 * NUNCA dentro de `use cache`.
 *
 * Apagado (default): el Shop se comporta como siempre. `/checkout` redirige a `/ingresar` a quien no
 * tiene sesión, `POST /api/pedidos` anónimo responde 401 y ningún endpoint del pedido acepta el token
 * del invitado. Prendido: un anónimo puede comprar sin cuenta (checkout de invitado, token firmado de
 * horas en memoria de la página; nada en cookie ni almacenamiento del navegador).
 *
 * NO gobierna la página `/pagar/[token]` (link «Pagar su pedido» de los mails): pagar un pedido ya
 * creado sigue funcionando con el flag apagado. Quien tiene sesión nunca depende del flag.
 *
 * Vive en Vercel Flags (key `compra-invitado`, ver src/flags.ts): se cambia sin redeploy. Si no se
 * puede evaluar, se asume apagado (fail-closed). Se prende primero en Preview/staging, y en
 * producción sólo después de la revisión de seguridad del aislamiento de pedidos.
 */
import { compraInvitadoFlag } from "@/flags";

export async function compraInvitadoHabilitada(): Promise<boolean> {
  try {
    return (await compraInvitadoFlag()) === true;
  } catch {
    return false;
  }
}
