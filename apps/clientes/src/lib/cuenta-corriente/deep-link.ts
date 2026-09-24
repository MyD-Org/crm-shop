/**
 * Deep link de una factura (`/mi-cuenta/facturas?factura=<n>&alegra=<id>`, el
 * que usan los avisos de vencimiento). SOLO servidor.
 *
 * Portado del comportamiento del portal (DashboardClient, `openFacturaId`):
 * 1. Con el id de Alegra, se valida la pertenencia ANTES de abrir el visor: un
 *    id ajeno o inexistente muestra "No encontramos la factura." y nada más.
 * 2. Sin él (avisos viejos), se busca por número en la página cargada y en las
 *    abiertas completas (los avisos son de facturas impagas).
 */
import { esIdAlegra } from "../alegra";
import { getDocumentPdf } from "./alegra-cc";
import { motivoAlegra } from "./mensajes";
import type { Factura } from "./tipos";
import type { DeepLinkFactura } from "./vista-facturas";

function primero(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

export async function resolverDeepLink(
  codigocliente: string,
  query: { factura?: string | string[]; alegra?: string | string[] },
  cargadas: readonly Factura[],
): Promise<DeepLinkFactura> {
  const numero = primero(query.factura);
  const alegraId = primero(query.alegra);
  if (!numero && !alegraId) return null;

  if (alegraId) {
    if (!esIdAlegra(alegraId) || alegraId.length > 20) return { noEncontrada: true };
    try {
      const doc = await getDocumentPdf("factura", alegraId);
      if (!doc || !doc.clientAlegraId || doc.clientAlegraId !== codigocliente) return { noEncontrada: true };
      return { abrir: { kind: "factura", alegraId, titulo: `Factura ${doc.number ?? numero ?? alegraId}` } };
    } catch (err) {
      // Alegra no respondió: se abre igual; la ruta del PDF vuelve a validar y el
      // visor muestra su error. Nunca se abre sin esa validación.
      console.error(`mi-cuenta/facturas: deep link sin validar (${motivoAlegra(err)})`);
      return { abrir: { kind: "factura", alegraId, titulo: `Factura ${numero ?? alegraId}` } };
    }
  }

  const f = cargadas.find((x) => x.id === numero);
  return f ? { abrir: { kind: "factura", alegraId: f.alegraId, titulo: `Factura ${f.id}` } } : { noEncontrada: true };
}
