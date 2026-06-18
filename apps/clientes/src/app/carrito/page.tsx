"use client";

import Link from "next/link";
import { Button, QuantityStepper } from "@myd-org/ui";
import { Footer } from "@/components/Footer";
import { useCart } from "@/context/CartContext";

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

export default function CarritoPage() {
  const { items, updateQty, removeItem: remove } = useCart();

  const subtotal = items.reduce((acc, item) => acc + item.price * item.qty, 0);
  const iva = Math.round(subtotal * 0.21);
  const total = subtotal + iva;

  const fmt = (n: number) =>
    n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 });

  if (items.length === 0) {
    return (
      <>
        <main className="mx-auto flex max-w-7xl flex-1 flex-col items-center justify-center gap-4 px-4 py-20">
          <p className="text-2xl font-bold text-text">Tu carrito esta vacio</p>
          <Link href="/catalogo">
            <Button>Ver catalogo</Button>
          </Link>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-7xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl font-extrabold text-text">Carrito de compras</h1>

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Items */}
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex gap-4 rounded-xl border border-border bg-surface p-4"
              >
                {/* Imagen */}
                <Link href={`/producto/${item.id}`} className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-elevated hover:opacity-80 transition-opacity">
                  <LightbulbIcon className="h-12 w-12 text-muted/30" />
                </Link>

                {/* Info */}
                <div className="flex flex-1 flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{item.brand}</p>
                  <Link href={`/producto/${item.id}`} className="text-sm font-semibold text-text hover:text-primary transition-colors">{item.name}</Link>
                  {item.variant && (
                    <p className="text-xs text-muted">{item.variant}</p>
                  )}
                  <p className="text-sm font-bold text-primary">{fmt(item.price)} c/u</p>
                </div>

                {/* Controles */}
                <div className="flex flex-col items-end justify-between gap-2">
                  <button
                    onClick={() => remove(item.id)}
                    className="text-muted transition-colors hover:text-danger"
                    aria-label="Eliminar producto"
                  >
                    <TrashIcon />
                  </button>
                  <div className="flex flex-col items-end gap-1">
                    <QuantityStepper
                      value={item.qty}
                      onValueChange={(qty) => updateQty(item.id, qty)}
                      min={1}
                      max={999}
                    />
                    <p className="text-sm font-bold text-text">
                      {fmt(item.price * item.qty)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Resumen */}
          <div className="h-fit rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-base font-bold text-text">Resumen del pedido</h2>

            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Subtotal ({items.reduce((a, i) => a + i.qty, 0)} productos)</span>
                <span className="font-medium text-text">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">IVA (21%)</span>
                <span className="font-medium text-text">{fmt(iva)}</span>
              </div>
              <div className="my-3 border-t border-border" />
              <div className="flex justify-between">
                <span className="font-bold text-text">Total</span>
                <span className="text-lg font-extrabold text-text">{fmt(total)}</span>
              </div>
              <p className="text-xs text-muted">Precio sin impuestos {fmt(subtotal)}</p>
            </div>

            <Link href="/checkout" className="mt-5 block">
              <Button className="w-full">Continuar al pago</Button>
            </Link>

            <Link
              href="/catalogo"
              className="mt-3 block text-center text-sm text-primary hover:underline"
            >
              Seguir comprando
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
