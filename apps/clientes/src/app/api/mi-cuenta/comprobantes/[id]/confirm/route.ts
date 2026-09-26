import { confirmarComprobante } from "@/lib/comprobantes/confirmar";
import { enviarAvisoComprobante } from "@/lib/comprobantes/mail";
import { COMPROBANTES_NO_DISPONIBLE, CONFIRM_CAIDO } from "@/lib/comprobantes/mensajes";
import * as repo from "@/lib/comprobantes/repo";
import { jsonNoStore, requerirCuentaCorriente } from "@/lib/cuenta-corriente/guard";
import { datosTenant } from "@/lib/cuenta-corriente/tenant-cc";
import { getComprobantesR2 } from "@/lib/r2";
import { shopTenantId } from "@/lib/tenant";

/**
 * Confirma el comprobante que el navegador subió directo a R2 (HEAD → sniff →
 * GET con tope → re-sniff → HEIC→JPEG → sha256 → PUT final → publicar → mail)
 * y lo deja `pending` para el backoffice. Idempotente: un segundo confirm de
 * una fila ya publicada responde 200 sin repetir el mail. Un id de otro
 * cliente responde 404, igual que uno inexistente.
 *
 * Portado de apps/admin/src/app/api/portal/comprobantes/[id]/confirm/route.ts.
 * El link del mail al backoffice sale de `CRM_ADMIN_URL`, nunca del request.
 *
 * Corre en Node.js (sharp, heic-decode): es el runtime por defecto y el único
 * que admite Cache Components, así que no hace falta declararlo.
 */
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requerirCuentaCorriente();
  if (guard.error) return guard.error;

  const r2 = getComprobantesR2();
  if (!r2) return jsonNoStore({ error: COMPROBANTES_NO_DISPONIBLE }, { status: 503 });

  try {
    const { id } = await params;
    const tenantId = shopTenantId();
    const result = await confirmarComprobante(
      { tenantId, codigocliente: guard.cliente.codigocliente, id },
      {
        repo,
        r2,
        avisar: async (receiptId, buffer, duplicadoDe) => {
          const tenant = await datosTenant();
          return enviarAvisoComprobante(
            {
              tenant: {
                id: tenantId,
                nombre: tenant?.nombre ?? tenantId,
                mailComprobantes: tenant?.mailComprobantes ?? null,
              },
              id: receiptId,
              buffer,
              duplicateOf: duplicadoDe,
            },
            { repo },
          );
        },
      },
    );

    if (result.ok) {
      return jsonNoStore({
        id,
        status: result.status,
        ...(result.duplicadoDe
          ? { duplicadoDe: { id: result.duplicadoDe.id, submittedAt: result.duplicadoDe.submittedAt.toISOString() } }
          : {}),
      });
    }
    return jsonNoStore({ error: result.error, code: result.code }, { status: result.status });
  } catch (err) {
    console.error("mi-cuenta/comprobantes: confirm falló", err instanceof Error ? err.name : "");
    return jsonNoStore({ error: CONFIRM_CAIDO }, { status: 500 });
  }
}
