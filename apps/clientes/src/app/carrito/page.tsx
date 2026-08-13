"use client";

import Link from "next/link";
import { Button, QuantityStepper } from "@myd-org/ui";
import { Footer } from "@/components/Footer";
import { useCart } from "@/context/CartContext";
import { useCotizacion } from "@/hooks/useCotizacion";
import { fmtPrecio } from "@/lib/format";

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

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export default function CarritoPage() {
  const { items, updateQty, removeItem: remove, ready } = useCart();
  // El carrito siempre cotiza como "retiro": la entrega se elige en el checkout.
  const { cotizacion, estado, error, recotizar } = useCotizacion({
    entregaTipo: "retiro",
  });

  // Mientras no llegó la cotización se muestra el precio guardado en el
  // carrito, marcado como estimado. Nunca se presenta como el precio final.
  const lineaDe = (id: string) => cotizacion?.lineas.find((l) => l.id === id);
  const confirmado = estado === "ok" && cotizacion;

  if (!ready) {
    return (
      <>
        <main className="mx-auto flex max-w-7xl flex-1 items-center justify-center px-4 py-20">
          <p className="text-sm text-muted">Cargando tu carrito…</p>
        </main>
        <Footer />
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <main className="mx-auto flex max-w-7xl flex-1 flex-col items-center justify-center gap-4 px-4 py-20">
          <p className="text-2xl font-bold text-text">Tu carrito está vacío</p>
          <Link href="/catalogo">
            <Button>Ver catálogo</Button>
          </Link>
        </main>
        <Footer />
      </>
    );
  }

  const subtotal = confirmado ? cotizacion.subtotal : items.reduce((a, i) => a + i.price * i.qty, 0);
  const iva = confirmado ? cotizacion.iva : null;
  const total = confirmado ? cotizacion.total : null;

  /**
   * Unidades que efectivamente suman al subtotal.
   *
   * Mientras no hay cotización se cuenta el carrito, que es lo único que hay.
   * Cuando sí la hay, se cuentan solo las líneas sin problema — que son las que
   * `cotizar` incluye en los totales.
   */
  const unidadesCotizadas = confirmado
    ? cotizacion.lineas.filter((l) => !l.problema).reduce((a, l) => a + l.qty, 0)
    : items.reduce((a, i) => a + i.qty, 0);

  return (
    <>
      <main className="mx-auto max-w-7xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl font-extrabold text-text">Carrito de compras</h1>

        {estado === "no_auth" && (
          <div className="mb-6 rounded-xl border border-border bg-elevated p-4 text-sm">
            <p className="font-semibold text-text">Ingresá para ver tus precios</p>
            <p className="mt-1 text-muted">
              Los precios y el stock son los de tu cuenta.{" "}
              <Link href="/ingresar" className="font-semibold text-primary hover:underline">
                Iniciar sesión
              </Link>
            </p>
          </div>
        )}

        {estado === "error" && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm">
            <span className="text-text">{error}</span>
            <button onClick={recotizar} className="shrink-0 font-semibold text-primary hover:underline">
              Reintentar
            </button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Items */}
          <div className="space-y-4">
            {items.map((item) => {
              const linea = lineaDe(item.id);
              const precio = linea && !linea.problema ? linea.precioUnitario : item.price;
              const totalLinea = linea && !linea.problema ? linea.total : item.price * item.qty;

              return (
                <div
                  key={item.id}
                  className={`flex gap-4 rounded-xl border bg-surface p-4 ${
                    linea?.problema ? "border-danger/40" : "border-border"
                  }`}
                >
                  <Link href={`/producto/${item.id}`} className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-elevated transition-opacity hover:opacity-80">
                    <LightbulbIcon className="h-12 w-12 text-muted/30" />
                  </Link>

                  <div className="flex flex-1 flex-col gap-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {linea?.brand || item.brand}
                    </p>
                    <Link href={`/producto/${item.id}`} className="text-sm font-semibold text-text transition-colors hover:text-primary">
                      {linea && !linea.problema ? linea.name : item.name}
                    </Link>
                    {item.variant && <p className="text-xs text-muted">{item.variant}</p>}
                    <p className="text-sm font-bold text-primary">
                      {fmtPrecio(precio)} c/u
                      {!confirmado && <span className="ml-1 text-xs font-normal text-muted">(estimado)</span>}
                    </p>

                    {linea?.problema && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-danger">
                        <AlertIcon />
                        {linea.detalle}
                      </p>
                    )}
                  </div>

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
                        max={linea?.stockDisponible ?? 999}
                      />
                      <p className="text-sm font-bold text-text">{fmtPrecio(totalLinea)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Resumen */}
          <div className="h-fit rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-base font-bold text-text">Resumen del pedido</h2>

            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">
                  {/*
                    Se cuentan las unidades que REALMENTE entran en el total, no
                    las del carrito. La cotización deja afuera las líneas con
                    problema, así que contar el carrito mostraba "1 productos"
                    junto a un subtotal de $0 y parecía un error de cálculo.
                  */}
                  Subtotal ({unidadesCotizadas}{" "}
                  {unidadesCotizadas === 1 ? "producto" : "productos"})
                </span>
                <span className="font-medium text-text">{fmtPrecio(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">IVA</span>
                <span className="font-medium text-text">
                  {iva === null ? "—" : fmtPrecio(iva)}
                </span>
              </div>
              <div className="my-3 border-t border-border" />
              <div className="flex justify-between">
                <span className="font-bold text-text">Total</span>
                <span className="text-lg font-extrabold text-text">
                  {total === null ? (
                    <span className="text-sm font-medium text-muted">
                      {estado === "cargando" ? "Calculando…" : "A confirmar"}
                    </span>
                  ) : (
                    fmtPrecio(total)
                  )}
                </span>
              </div>
              {total !== null && (
                <p className="text-xs text-muted">Precio sin impuestos {fmtPrecio(subtotal)}</p>
              )}
            </div>

            {cotizacion?.hayProblemas && (
              <p className="mt-4 rounded-lg bg-danger/5 p-3 text-xs text-danger">
                Revisá los productos marcados antes de continuar.
              </p>
            )}

            <Link href="/checkout" className="mt-5 block">
              <Button className="w-full" disabled={cotizacion?.hayProblemas}>
                Continuar
              </Button>
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
