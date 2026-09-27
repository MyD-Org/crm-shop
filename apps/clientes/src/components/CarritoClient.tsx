"use client";

import Link from "next/link";
import Image from "next/image";
import { rutaIngreso } from "@/lib/ingreso";
import { Button, QuantityStepper } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import { useCotizacion } from "@/hooks/useCotizacion";
import { fmtPrecio } from "@/lib/format";
import { CuotasResumen } from "@/components/CuotasResumen";
import { baseCarrito, resumenCuotas } from "@/lib/cuotas-exhibicion";
import { precioLineaCarrito, totalesEstimados } from "@/lib/carrito-precios";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import { formatNombreProducto } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import { EntregaProducto } from "@/components/producto/EntregaProducto";

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
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

/**
 * Carrito. `oferta` llega resuelta desde el Server Component `carrito/page.tsx`
 * (null = sin cuotas). Las cuotas se recalculan en el cliente con cada cambio
 * de cantidad, sin roundtrip.
 *
 * Sin sesión también se cotiza (lista L1, ver /api/carrito/cotizar): el aviso
 * de iniciar sesión depende de `conSesion`, no de la cotización.
 *
 * Una sola lista con separadores (no una card por producto): con muchos
 * productos, el doble a la vista. El total de cada línea va destacado a la
 * derecha y el unitario en gris; el precio sin impuestos se ve una vez, en el
 * resumen (Subtotal + Impuestos). El resumen queda fijo en desktop; en
 * mobile, una barra abajo con el total y el botón.
 */
export function CarritoClient({
  oferta,
  conSesion,
  envio = false,
}: {
  oferta: OfertaCuotas | null;
  conSesion: boolean;
  /** Flag `envio` (ver src/lib/envio-flag.ts): si se anuncia el envío a domicilio. */
  envio?: boolean;
}) {
  const { items, updateQty, removeItem: remove, ready } = useCart();
  // El carrito siempre cotiza como "retiro": la entrega se elige en el checkout.
  const { cotizacion, estado, error, recotizar, ultimasLineas } = useCotizacion({
    entregaTipo: "retiro",
  });

  // Los precios de cada línea salen de la cotización, con IVA como en la ficha
  // (ver precioLineaCarrito): el neto guardado en el carrito no se muestra.
  const lineaDe = (id: string) => cotizacion?.lineas.find((l) => l.id === id);
  const confirmado = estado === "ok" && cotizacion;

  if (!ready) {
    return (
      <>
        <main className="mx-auto flex w-full max-w-contenido flex-1 items-center justify-center px-4 py-20">
          <p className="text-sm text-muted">Cargando el carrito…</p>
        </main>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <main className="mx-auto flex w-full max-w-contenido flex-1 flex-col items-center justify-center gap-4 px-4 py-20">
          <p className="text-2xl font-bold text-text">El carrito está vacío</p>
          <Link href="/catalogo">
            <Button>Ver catálogo</Button>
          </Link>
        </main>
      </>
    );
  }

  // Mientras recotiza, el resumen se estima al instante con los unitarios ya
  // cotizados (ver totalesEstimados) y la cotización lo confirma al llegar.
  // Sin nada con qué estimar (primera carga, producto recién agregado), null:
  // "Calculando…", nunca el neto guardado en el carrito como si fuera el total.
  const estimados = confirmado ? null : totalesEstimados(items, ultimasLineas);
  const subtotal = confirmado ? cotizacion.subtotal : (estimados?.subtotal ?? null);
  const iva = confirmado ? cotizacion.iva : (estimados?.iva ?? null);
  const total = confirmado ? cotizacion.total : (estimados?.total ?? null);

  /**
   * Unidades que efectivamente suman al subtotal.
   *
   * Mientras no hay cotización se cuenta el carrito, que es lo único que hay.
   * Cuando sí la hay, se cuentan solo las líneas sin problema — que son las que
   * `cotizar` incluye en los totales.
   */
  // Base de cuotas = total con IVA. Confirmado → el de la cotización; mientras
  // recotiza → estimado con los precios/IVA ya conocidos y las cantidades nuevas.
  const resumen = resumenCuotas(
    baseCarrito({ items, totalConfirmado: confirmado ? cotizacion.total : null, ultimasLineas }),
    oferta,
  );

  const unidadesCotizadas = confirmado
    ? cotizacion.lineas.filter((l) => !l.problema).reduce((a, l) => a + l.qty, 0)
    : items.reduce((a, i) => a + i.qty, 0);

  const textoTotal =
    total === null ? (estado === "cargando" ? "Calculando…" : "A confirmar") : fmtPrecio(total);
  const unidadesCarrito = items.reduce((a, it) => a + it.qty, 0);

  const botonCompra = (
    <Link href="/checkout" className="block" aria-disabled={cotizacion?.hayProblemas || undefined}>
      <Button className="w-full" disabled={cotizacion?.hayProblemas}>
        Iniciar compra
      </Button>
    </Link>
  );

  return (
    <>
      <main className="mx-auto w-full max-w-contenido flex-1 px-4 pt-6 lg:pb-16 lg:pt-8">
        <div className="mb-5 flex items-baseline gap-3 lg:mb-6">
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-text lg:text-[32px]">Carrito</h1>
          <span className="text-sm font-semibold text-muted">
            {unidadesCarrito} {unidadesCarrito === 1 ? "producto" : "productos"}
          </span>
        </div>

        {(!conSesion || estado === "no_auth") && (
          <div className="mb-6 rounded-[20px] border border-border bg-elevated p-4 text-sm">
            <p className="text-muted">
              Inicie sesión para completar su compra.{" "}
              <Link href={rutaIngreso("/carrito")} className="font-semibold text-primary hover:underline">
                Iniciar sesión
              </Link>
            </p>
          </div>
        )}

        {estado === "error" && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-[20px] border border-danger/40 bg-danger/5 p-4 text-sm">
            <span className="text-text">{error}</span>
            <button onClick={recotizar} className="shrink-0 font-semibold text-primary hover:underline">
              Reintentar
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-9">
          {/* Items */}
          <ul className="rounded-[20px] border border-border bg-surface px-4 lg:px-6">
            {items.map((item) => {
              const linea = lineaDe(item.id);
              const precio = precioLineaCarrito(
                item.qty,
                linea,
                ultimasLineas?.find((l) => l.id === item.id),
              );

              const marca = linea?.brand || item.brand;
              const nombre = linea && !linea.problema ? linea.name : item.name;
              // Sólo para mostrar: el nombre que viaja en el pedido no se toca.
              const nombreParaMostrar = formatNombreProducto(nombre, marca ? formatMarca(marca) : undefined);

              const cantidad = (
                <QuantityStepper
                  value={item.qty}
                  onValueChange={(qty) => updateQty(item.id, qty)}
                  min={1}
                  max={linea?.stockDisponible ?? 999}
                />
              );
              const quitar = (
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="rounded-sm text-[13px] font-semibold text-muted underline underline-offset-4 transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                  aria-label={`Quitar ${nombreParaMostrar} del carrito`}
                >
                  Quitar
                </button>
              );
              const totalLinea = precio ? (
                <p className="font-display text-base font-semibold tabular-nums text-text lg:text-[17px]">
                  {fmtPrecio(precio.total)}
                </p>
              ) : null;

              return (
                <li
                  key={item.id}
                  className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-border py-4 last:border-b-0 lg:grid-cols-[64px_minmax(0,1fr)_auto_128px] lg:items-center lg:gap-x-5"
                >
                  <Link
                    href={`/producto/${item.id}`}
                    className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface transition-opacity hover:opacity-80 lg:h-16 lg:w-16"
                  >
                    {item.image ? (
                      <Image src={item.image} alt="" fill sizes="64px" className="object-contain p-1" />
                    ) : (
                      <LightbulbIcon className="h-8 w-8 text-muted/30" />
                    )}
                  </Link>

                  <div className="min-w-0">
                    {marca && <p className="text-[12.5px] font-bold text-accent">{formatMarca(marca)}</p>}
                    <Link
                      href={`/producto/${item.id}`}
                      className="break-words text-[15px] font-bold leading-snug text-text transition-colors hover:text-accent"
                    >
                      {nombreParaMostrar}
                    </Link>
                    {item.variant && <p className="text-xs text-muted">{item.variant}</p>}
                    {precio ? (
                      <p className="text-[13px] tabular-nums text-muted">{fmtPrecio(precio.unitario)} c/u</p>
                    ) : (
                      estado === "cargando" && <p className="text-[13px] text-muted">Calculando…</p>
                    )}
                    <div className="mt-1 lg:hidden">{quitar}</div>
                    {linea?.problema && (
                      <p className="mt-1 flex items-center gap-1.5 text-[12.5px] font-bold text-danger">
                        <AlertIcon />
                        {linea.detalle}
                      </p>
                    )}
                  </div>

                  {/* Desktop: cantidad con "Quitar" debajo, y el total en su columna. */}
                  <div className="hidden flex-col items-center gap-1 lg:flex">
                    {cantidad}
                    {quitar}
                  </div>
                  <div className="hidden text-right lg:block">{totalLinea}</div>

                  {/* Mobile: cantidad y total en una fila debajo del nombre ("Quitar"
                      va junto al unitario: los tres juntos no entran en 375 px). */}
                  <div className="col-start-2 flex min-w-0 items-center justify-between gap-3 lg:hidden">
                    {cantidad}
                    {totalLinea}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Resumen */}
          <aside className="h-fit space-y-5 rounded-[20px] border border-border bg-surface p-5 lg:sticky lg:top-24 lg:p-6">
            <h2 className="font-display text-lg font-semibold text-text">Resumen del pedido</h2>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                {/* Subtotal = precio sin impuestos (Ley 27.743): se ve acá, con los
                    impuestos debajo, y no se repite en cada fila. */}
                <dt className="text-muted">Subtotal</dt>
                <dd className="font-medium tabular-nums text-text">{subtotal === null ? "—" : fmtPrecio(subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Impuestos</dt>
                <dd className="font-medium tabular-nums text-text">{iva === null ? "—" : fmtPrecio(iva)}</dd>
              </div>
            </dl>
            {/*
              La cotización deja afuera las líneas con problema: si no entran
              todas las unidades, se dice cuántas suman (antes, "1 productos"
              junto a $0 parecía un error de cálculo).
            */}
            {unidadesCotizadas !== unidadesCarrito && (
              <p className="-mt-3 text-xs text-muted">
                Incluye {unidadesCotizadas} de {unidadesCarrito} productos: no suma los marcados.
              </p>
            )}

            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-4">
              <span className="font-bold text-text">Total</span>
              <span
                className={
                  total === null
                    ? "text-sm font-medium text-muted"
                    : "font-display text-2xl font-bold tracking-tight tabular-nums text-text"
                }
              >
                {textoTotal}
              </span>
            </div>

            <CuotasResumen resumen={resumen} />

            {cotizacion?.hayProblemas && (
              <p className="rounded-lg bg-danger/5 p-3 text-xs text-danger">
                Revise los productos marcados antes de continuar.
              </p>
            )}

            {/* En mobile el botón va en la barra fija de abajo. */}
            <div className="hidden space-y-3 lg:block">
              {botonCompra}
              <Link href="/catalogo" className="block text-center text-sm font-semibold text-accent hover:underline">
                Seguir comprando
              </Link>
            </div>

            <EntregaProducto envio={envio} />

            <Link href="/catalogo" className="block text-center text-sm font-semibold text-accent hover:underline lg:hidden">
              Seguir comprando
            </Link>
          </aside>
        </div>

        {/* Barra de compra en mobile: sticky y última del main, acompaña el
            scroll y se detiene donde empieza el footer. */}
        <div data-sin-footer-mobile className="sticky bottom-0 z-30 -mx-4 mt-8 flex items-center gap-4 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <div className="shrink-0">
            <p className="text-xs font-semibold text-muted">Total</p>
            <p className="font-display text-lg font-bold tabular-nums text-text">{textoTotal}</p>
          </div>
          <div className="min-w-0 flex-1">{botonCompra}</div>
        </div>
      </main>
    </>
  );
}
