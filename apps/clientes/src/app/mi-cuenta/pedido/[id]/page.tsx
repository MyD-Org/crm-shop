import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Footer } from "@/components/Footer";
import { identidadActual } from "@/lib/auth";
import { getPedido } from "@/lib/pedidos";
import { ORDER_ESTADO_LABEL, PAGO_ESTADO_LABEL } from "@/data/orders";
import { fmtFecha, fmtPrecio } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect("/ingresar");

  // getPedido filtra por dueño: un id ajeno da 404, no 403 — no confirmamos la
  // existencia de pedidos de otras cuentas.
  const pedido = await getPedido(id, {
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });
  if (!pedido) notFound();

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <nav className="mb-6 text-sm text-muted">
          <Link href="/mi-cuenta" className="hover:text-primary">Mi cuenta</Link>
          <span className="px-1.5">/</span>
          <span className="text-text">{pedido.numero}</span>
        </nav>

        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-text">Pedido {pedido.numero}</h1>
            <p className="mt-1 text-sm text-muted">{fmtFecha(pedido.fecha)}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-sm">
            <span className="font-semibold text-text">
              {ORDER_ESTADO_LABEL[pedido.estado]}
            </span>
            <span className="text-muted">{PAGO_ESTADO_LABEL[pedido.pagoEstado]}</span>
          </div>
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-2 text-sm font-bold text-text">Entrega</h2>
            <p className="text-sm text-muted">{pedido.metodoEntrega}</p>
            {pedido.entregaDireccion && (
              <p className="mt-1 text-sm text-text">
                {pedido.entregaDireccion}
                {pedido.entregaCiudad ? `, ${pedido.entregaCiudad}` : ""}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-2 text-sm font-bold text-text">Pago</h2>
            <p className="text-sm text-muted">{pedido.metodoPago}</p>
            <p className="mt-1 text-sm text-text">{PAGO_ESTADO_LABEL[pedido.pagoEstado]}</p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface">
          <h2 className="border-b border-border px-5 py-3.5 text-sm font-bold text-text">
            Productos
          </h2>
          <ul className="divide-y divide-border">
            {pedido.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/producto/${item.id}`}
                    className="truncate text-sm font-medium text-text hover:text-primary"
                  >
                    {item.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {item.code ? `${item.code} · ` : ""}
                    {item.qty} u. · {fmtPrecio(item.price)} c/u
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-text">
                  {fmtPrecio(item.total)}
                </p>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-border px-5 py-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="font-medium text-text">{fmtPrecio(pedido.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">IVA</span>
              <span className="font-medium text-text">{fmtPrecio(pedido.iva)}</span>
            </div>
            {pedido.costoEnvio > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Envío</span>
                <span className="font-medium text-text">{fmtPrecio(pedido.costoEnvio)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2">
              <span className="font-bold text-text">Total</span>
              <span className="text-lg font-extrabold text-text">
                {fmtPrecio(pedido.total)}
              </span>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
