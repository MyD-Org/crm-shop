import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@myd-org/ui";
import { ipDelRequest } from "@/lib/ip-cliente";
import { acuñarTokenCompra, verificarToken } from "@/lib/pedido-token";
import { getPedidoParaLink } from "@/lib/pedidos";
import { permitirAsync } from "@/lib/rate-limit";
import { TEXTOS_PAGAR } from "@/lib/pagar-textos";

/**
 * «Pagar su pedido»: el link firmado de los mails al invitado (change `compra-como-invitado`, S3).
 *
 * El link (token de propósito `pago`, ver `pedido-link-pago.ts`) NO se acepta en la API: esta página lo
 * verifica y, si el pedido sigue pendiente de pago en línea, lo canjea por un token de `compra` (vida
 * corta) y lleva al comprador a `/checkout?pedido=<id>&t=<token>`, que retoma el cobro de ESE pedido
 * (el checkout saca `t` de la barra de direcciones y no lo mide). Permite ver y pagar el pedido o
 * reintentar el pago; nunca listar pedidos ni cancelar. FUNCIONA CON EL FLAG `compra-invitado`
 * APAGADO: el flag gobierna crear pedidos nuevos, no pagar uno que ya existe.
 *
 * Una sola respuesta para todo lo que no se puede pagar (firma alterada, vencido, pedido inexistente,
 * ajeno, con cuenta, cancelado, en otro medio): no revela si el pedido existe. «Ya pagado» sólo
 * aparece con un link firmado válido y no muestra el pedido. Sin DNI, CUIT, teléfono ni domicilio.
 * Headers (sin referrer, sin caché, noindex) y exclusión del tracking: `headers-seguridad.ts` y
 * `tracking/url.ts`.
 */
const POR_MINUTO_Y_IP = 20;

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <main className="mx-auto flex w-full max-w-contenido flex-1 flex-col items-center justify-center gap-4 px-4 py-20 text-center">
      <h1 className="font-display text-2xl font-medium text-text">{titulo}</h1>
      <p role="alert" className="max-w-md text-sm text-muted">
        {texto}
      </p>
      <Link href="/catalogo">
        <Button variant="outline">{TEXTOS_PAGAR.verCatalogo}</Button>
      </Link>
    </main>
  );
}

export default async function PagarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Límite por IP (nunca por token): un link adivinado a ciegas no se prueba a ritmo de máquina.
  const ip = ipDelRequest(new Request("http://localhost", { headers: await headers() }));
  if (!(await permitirAsync(`pagar:ip:${ip ?? "desconocida"}`, POR_MINUTO_Y_IP, 60_000))) {
    return <Aviso titulo={TEXTOS_PAGAR.limiteTitulo} texto={TEXTOS_PAGAR.limite} />;
  }

  const link = verificarToken(token, "pago");
  if (!link.ok) return <Aviso titulo={TEXTOS_PAGAR.noDisponibleTitulo} texto={TEXTOS_PAGAR.noDisponible} />;

  const estado = await getPedidoParaLink(link.orderId);
  if (estado === "no_disponible") {
    return <Aviso titulo={TEXTOS_PAGAR.noDisponibleTitulo} texto={TEXTOS_PAGAR.noDisponible} />;
  }
  if (estado === "pagado") return <Aviso titulo={TEXTOS_PAGAR.pagadoTitulo} texto={TEXTOS_PAGAR.pagado} />;

  const { token: tokenCompra } = acuñarTokenCompra(link.orderId);
  redirect(`/checkout?pedido=${encodeURIComponent(link.orderId)}&t=${encodeURIComponent(tokenCompra)}`);
}
