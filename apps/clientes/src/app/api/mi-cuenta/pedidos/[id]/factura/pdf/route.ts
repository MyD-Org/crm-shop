import { esLimiteAlegra, getDocumentPdf } from "@/lib/cuenta-corriente/alegra-cc";
import { motivoAlegra } from "@/lib/cuenta-corriente/mensajes";
import { identidadActual } from "@/lib/auth";
import { getPedido } from "@/lib/pedidos";

/**
 * PDF de la factura de Alegra vinculada a UN pedido ("Vincular factura" del
 * CRM). `?download=1` la baja como archivo.
 *
 * A diferencia de `/api/mi-cuenta/documentos/[kind]/[id]` (que exige acceso a
 * Facturación, es decir cuenta corriente), esta ruta autoriza por DUEÑO DEL
 * PEDIDO: `getPedido` ya filtra por `clerkUserId`/`clienteCodigo` de la sesión
 * (`esDeSuDueno` en `lib/pedidos.ts`), así que sirve también para un
 * consumidor final sin vínculo comercial. El id de la factura sale del pedido
 * ya validado, nunca del path ni del query.
 *
 * El PDF se PROXEA igual que en `documentos/[kind]/[id]`: la URL que da Alegra
 * está firmada (quien la tiene entra sin sesión), así que nunca sale de este
 * proceso, ni en la respuesta ni en logs.
 */
const NO_STORE = "private, no-store";

function jsonNoStore(body: unknown, init: ResponseInit = {}): Response {
  const res = Response.json(body, init);
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

const SIN_SESION = "Inicie sesión para ver sus pedidos.";
const PEDIDO_NO_ENCONTRADO = "No encontramos el pedido.";
const SIN_FACTURA = "Este pedido todavía no tiene una factura vinculada.";
const FACTURA_CAIDA = "No pudimos obtener la factura. Inténtelo de nuevo en unos minutos.";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return jsonNoStore({ error: SIN_SESION }, { status: 401 });
  }

  const pedido = await getPedido(id, { clerkUserId, clienteCodigo: cliente?.codigocliente });
  // Ajeno e inexistente responden lo mismo: no se confirma que el id exista.
  if (!pedido) return jsonNoStore({ error: PEDIDO_NO_ENCONTRADO }, { status: 404 });
  if (!pedido.facturaId) return jsonNoStore({ error: SIN_FACTURA }, { status: 404 });

  let doc: Awaited<ReturnType<typeof getDocumentPdf>>;
  try {
    doc = await getDocumentPdf("factura", pedido.facturaId);
  } catch (err) {
    console.error(`mi-cuenta/pedidos/factura: Alegra falló (${motivoAlegra(err)})`);
    return jsonNoStore({ error: FACTURA_CAIDA }, { status: esLimiteAlegra(err) ? 503 : 502 });
  }
  if (!doc || !doc.pdfUrl) return jsonNoStore({ error: FACTURA_CAIDA }, { status: 502 });

  let pdf: Response;
  try {
    pdf = await fetch(doc.pdfUrl, { cache: "no-store" });
  } catch {
    console.error("mi-cuenta/pedidos/factura: sin respuesta del PDF");
    return jsonNoStore({ error: FACTURA_CAIDA }, { status: 502 });
  }
  if (!pdf.ok || !pdf.body) {
    console.error(`mi-cuenta/pedidos/factura: el PDF respondió ${pdf.status}`);
    return jsonNoStore({ error: FACTURA_CAIDA }, { status: 502 });
  }

  const descarga = new URL(request.url).searchParams.get("download") === "1";
  const numero = (doc.number ?? pedido.facturaId).replace(/[^\w.-]+/g, "-");
  const res = new Response(pdf.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${descarga ? "attachment" : "inline"}; filename="factura-${numero}.pdf"`,
    },
  });
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}
