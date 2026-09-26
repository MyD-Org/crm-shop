import { esIdAlegra } from "@/lib/alegra";
import { esDocumentKind, esLimiteAlegra, getDocumentPdf } from "@/lib/cuenta-corriente/alegra-cc";
import { jsonNoStore, noStore, requerirCuentaCorriente } from "@/lib/cuenta-corriente/guard";
import {
  DOCUMENTO_CAIDO,
  DOCUMENTO_INVALIDO,
  DOCUMENTO_NO_ENCONTRADO,
  motivoAlegra,
} from "@/lib/cuenta-corriente/mensajes";

/**
 * PDF de un documento del cliente (factura, recibo de pago o presupuesto),
 * para el visor de Mi cuenta. `?download=1` lo baja como archivo.
 *
 * Portado de apps/admin/src/app/api/portal/documentos/[kind]/[id]/route.ts.
 * El PDF se PROXEA: la URL que da Alegra está firmada (quien la tiene entra sin
 * sesión), así que nunca sale de este proceso, ni en la respuesta ni en logs.
 *
 * Los errores son JSON `{ error }`: el visor del DS (`DocumentViewer`) los baja
 * con fetch y muestra ese texto en vez del JSON crudo dentro del `<iframe>`.
 */
/** Tope del id: los de Alegra son numéricos y cortos; esto corta rutas raras antes de llamar. */
const ID_DOCUMENTO = /^[0-9]{1,20}$/;

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!esDocumentKind(kind) || !ID_DOCUMENTO.test(id) || !esIdAlegra(id)) {
    return jsonNoStore({ error: DOCUMENTO_INVALIDO }, { status: 400 });
  }

  const guard = await requerirCuentaCorriente();
  if (guard.error) return guard.error;

  let doc: Awaited<ReturnType<typeof getDocumentPdf>>;
  try {
    doc = await getDocumentPdf(kind, id);
  } catch (err) {
    console.error(`mi-cuenta/documentos: Alegra falló para ${kind} (${motivoAlegra(err)})`);
    return jsonNoStore({ error: DOCUMENTO_CAIDO }, { status: esLimiteAlegra(err) ? 503 : 502 });
  }

  // El control que sostiene todo esto: el documento tiene que ser del cliente de la
  // identidad. Sin contacto se trata como ajeno (fail-closed), y ajeno responde lo
  // mismo que inexistente: no se confirma que el id exista.
  if (!doc || !doc.clientAlegraId || doc.clientAlegraId !== guard.cliente.codigocliente) {
    return jsonNoStore({ error: DOCUMENTO_NO_ENCONTRADO }, { status: 404 });
  }
  if (!doc.pdfUrl) return jsonNoStore({ error: DOCUMENTO_CAIDO }, { status: 502 });

  let pdf: Response;
  try {
    pdf = await fetch(doc.pdfUrl, { cache: "no-store" });
  } catch {
    console.error(`mi-cuenta/documentos: sin respuesta del PDF de ${kind}`);
    return jsonNoStore({ error: DOCUMENTO_CAIDO }, { status: 502 });
  }
  if (!pdf.ok || !pdf.body) {
    console.error(`mi-cuenta/documentos: el PDF de ${kind} respondió ${pdf.status}`);
    return jsonNoStore({ error: DOCUMENTO_CAIDO }, { status: 502 });
  }

  const descarga = new URL(request.url).searchParams.get("download") === "1";
  const numero = (doc.number ?? id).replace(/[^\w.-]+/g, "-");
  return noStore(
    new Response(pdf.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${descarga ? "attachment" : "inline"}; filename="${kind}-${numero}.pdf"`,
      },
    }),
  );
}
