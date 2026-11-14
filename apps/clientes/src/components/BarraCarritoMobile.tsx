"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useCotizacion } from "@/hooks/useCotizacion";
import { MetasCarrito } from "@/components/carrito/MetasCarrito";
import { metaCuotas } from "@/lib/metas-carrito";
import type { PagoTransferencia } from "@/lib/pago-transferencia-servidor";
import { precioLineaCarrito, totalesEstimados } from "@/lib/carrito-precios";
import { fmtPrecio } from "@/lib/format";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import { useHidratado } from "@/lib/hidratado";

function LightbulbIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

function ChevronArribaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function CruzIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/**
 * Carrito al alcance del pulgar en el celular (debajo de `lg`): una barra fija
 * abajo con la cantidad y el total, que abre una hoja con los productos y
 * "Iniciar compra" sin salir de la página (patrón de Rappi o Shopify).
 *
 * Sólo aparece con productos en el carrito. Las páginas que ya tienen su
 * propia barra de compra (ficha, carrito: `data-barra-compra`) o que van sin
 * footer en mobile (checkout: `data-sin-footer-mobile`) la ocultan por CSS
 * (`[data-barra-carrito]` en globals.css): nunca dos barras fijas.
 *
 * La barra no muestra plata: el precio guardado en el carrito es el neto, sin
 * IVA, y cotizar en cada página sería un pedido a Alegra por visita. La hoja sí
 * cotiza (como /carrito), y sólo mientras está abierta.
 */
/** Evento con el que otra parte de la página (la barra de la ficha) abre la hoja. */
const EVENTO_ABRIR_HOJA = "carrito:abrir-hoja";

/** Abre la hoja del carrito desde fuera de la barra (la ficha no muestra la barra). */
export function abrirHojaCarrito() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_HOJA));
}

export function BarraCarritoMobile() {
  const carrito = useCart();
  const hidratado = useHidratado();
  const [abierta, setAbierta] = useState(false);
  const cerrarRef = useRef<HTMLButtonElement>(null);

  const count = hidratado ? carrito.count : 0;

  useEffect(() => {
    const abrir = () => setAbierta(true);
    window.addEventListener(EVENTO_ABRIR_HOJA, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_HOJA, abrir);
  }, []);

  // Hoja abierta: Escape la cierra, el foco entra al botón de cerrar y la
  // página de fondo no scrollea.
  useEffect(() => {
    if (!abierta) return;
    const html = document.documentElement;
    const antes = html.style.overflow;
    html.style.overflow = "hidden";
    // Al cerrar, el foco vuelve a lo que la abrió (la barra o el botón de la ficha).
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cerrarRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierta(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = antes;
      document.removeEventListener("keydown", onKey);
      previo?.focus({ preventScroll: true });
    };
  }, [abierta]);

  // Si se vacía con la hoja abierta, se cierra.
  if (abierta && count === 0) setAbierta(false);

  if (count === 0) return null;

  // La hoja va fuera de `data-barra-carrito`: en la ficha la barra se oculta por
  // CSS, pero la hoja se abre igual desde su botón «Ver carrito».
  return (
    <>
    <div data-barra-carrito className="lg:hidden">
      {/* Reserva el alto de la barra al final de la página: sin esto tapaba el
          final del footer. */}
      <div aria-hidden className="h-[calc(5.5rem+env(safe-area-inset-bottom))]" />

      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-haspopup="dialog"
        aria-expanded={abierta}
        className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex h-14 items-center justify-between rounded-xl bg-primary px-4 text-on-primary shadow-lg transition-transform active:scale-[0.98] motion-safe:animate-aparecer"
      >
        <span className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-surface px-1.5 text-[13px] font-extrabold tabular-nums text-primary">
            {count}
          </span>
          Ver carrito
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold">
          Comprar
          <ChevronArribaIcon />
        </span>
      </button>
    </div>

    {abierta && <HojaCarrito count={count} cerrarRef={cerrarRef} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

/**
 * La hoja con los productos. Va aparte para que la cotización (useCotizacion)
 * sólo corra con la hoja abierta. Precios y total con IVA, de la cotización,
 * como en /carrito (retiro, el mismo punto de partida que la página): el neto
 * guardado en el carrito no se muestra.
 */
function HojaCarrito({
  count,
  cerrarRef,
  onCerrar,
}: {
  count: number;
  cerrarRef: React.RefObject<HTMLButtonElement | null>;
  onCerrar: () => void;
}) {
  const carrito = useCart();
  const { items } = carrito;
  // Precio con transferencia (como /carrito): se pregunta al servidor con qué lista cotizar, porque
  // depende de quien mira. `undefined` = todavía no se sabe; null = sin precio con transferencia.
  const [pago, setPago] = useState<PagoTransferencia | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/carrito/pago-transferencia", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { pago: null }))
      .then((d: { pago?: PagoTransferencia }) => setPago(d.pago ?? null))
      .catch(() => {
        if (!controller.signal.aborted) setPago(null);
      });
    return () => controller.abort();
  }, []);
  const { cotizacion, estado, ultimasLineas, ultimoProgresoCuotas } = useCotizacion({
    entregaTipo: "retiro",
    conProgresoCuotas: true,
    activo: pago !== undefined,
    ...(pago ?? {}),
  });
  // Total con los demás medios (precio general), sólo si hay precio con transferencia.
  const { cotizacion: cotizacionGeneral, estado: estadoGeneral } = useCotizacion({
    entregaTipo: "retiro",
    activo: Boolean(pago),
  });
  // Cuotas sin interés, igual que en /carrito: «Ya tiene 3 cuotas de $X» y cuánto falta para el
  // próximo escalón. Sin cuotas configuradas, nada.
  const metaDeCuotas = metaCuotas(ultimoProgresoCuotas);
  const lineaVigente = (id: string) => cotizacion?.lineas.find((l) => l.id === id);
  const lineaUltima = (id: string) => ultimasLineas?.find((l) => l.id === id);
  const total = cotizacion ? cotizacion.total : (totalesEstimados(items, ultimasLineas)?.total ?? null);
  const textoTotal =
    total !== null ? fmtPrecio(total) : estado === "cargando" || pago === undefined ? "Calculando…" : "A confirmar";
  const totalOtrosMedios =
    pago && estadoGeneral === "ok" && cotizacionGeneral && total !== null && cotizacionGeneral.total > total
      ? cotizacionGeneral.total
      : null;
  const conProblemas = !!cotizacion?.hayProblemas;

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar carrito"
        onClick={onCerrar}
        className="absolute inset-0 bg-black/45 motion-safe:animate-aparecer"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoja-carrito-titulo"
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-[20px] bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))] motion-safe:animate-subir"
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between px-4 pt-1">
          <h2 id="hoja-carrito-titulo" className="text-lg font-semibold text-text">
            Su carrito <span className="font-normal text-muted">({count})</span>
          </h2>
          <button
            ref={cerrarRef}
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-mr-2.5 flex h-11 w-11 items-center justify-center text-muted transition-colors hover:text-text"
          >
            <CruzIcon />
          </button>
        </div>

        <ul className="scroll-fino min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {items.map((item) => {
            const nombre = nombreConMarca(item.name, item.brand ? formatMarca(item.brand) : undefined).nombre;
            const precio = precioLineaCarrito(item.qty, lineaVigente(item.id), lineaUltima(item.id));
            const problema = lineaVigente(item.id)?.problema;
            return (
              <li key={item.id} className="flex items-center gap-3 border-b border-border py-3">
                <Link
                  href={`/producto/${item.id}`}
                  onClick={onCerrar}
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-elevated text-muted/50"
                >
                  {item.image ? (
                    <Image src={item.image} alt={nombre} fill sizes="56px" className="object-contain p-1" />
                  ) : (
                    <LightbulbIcon />
                  )}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link href={`/producto/${item.id}`} onClick={onCerrar} className="line-clamp-2 text-sm leading-snug text-text">
                    {nombre}
                  </Link>
                  {problema ? (
                    <span className="text-xs font-medium text-danger">No disponible: revíselo en el carrito</span>
                  ) : precio ? (
                    <span className="text-[15px] font-semibold tabular-nums text-text">{fmtPrecio(precio.total)}</span>
                  ) : (
                    <span aria-label="Calculando el precio" className="h-4 w-20 animate-pulse rounded bg-elevated" />
                  )}
                </div>
                <div className="flex h-10 shrink-0 items-center rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() =>
                      item.qty > 1 ? carrito.updateQty(item.id, item.qty - 1) : carrito.removeItem(item.id)
                    }
                    aria-label={item.qty > 1 ? `Quitar una unidad de ${nombre}` : `Quitar ${nombre} del carrito`}
                    className="flex h-10 w-10 items-center justify-center text-lg text-text"
                  >
                    −
                  </button>
                  <span className="min-w-5 text-center text-sm font-semibold tabular-nums text-text" aria-live="polite">
                    {item.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => carrito.updateQty(item.id, item.qty + 1)}
                    aria-label={`Agregar una unidad de ${nombre}`}
                    className="flex h-10 w-10 items-center justify-center text-lg text-text"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {metaDeCuotas && (
          <div className="px-4 pt-3">
            <MetasCarrito metas={[metaDeCuotas]} compacta />
          </div>
        )}

        <div className="flex flex-col gap-3 px-4 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-semibold text-text">{pago ? "Total con transferencia" : "Total"}</span>
            <span className="text-[22px] font-bold tabular-nums text-text">{textoTotal}</span>
          </div>
          {totalOtrosMedios !== null && (
            <p className="-mt-2 text-right text-sm text-muted">
              Con otros medios de pago: <span className="tabular-nums">{fmtPrecio(totalOtrosMedios)}</span>
            </p>
          )}
          {/* Con algún producto con problema (sin stock, ya no está) se revisa en
              el carrito, que explica qué pasa con cada uno. */}
          <Link
            href={conProblemas ? "/carrito" : "/checkout"}
            onClick={onCerrar}
            className="flex h-[52px] items-center justify-center rounded-xl bg-primary text-base font-semibold text-on-primary transition-colors hover:bg-accent"
          >
            {conProblemas ? "Revisar carrito" : "Iniciar compra"}
          </Link>
          <Link
            href="/carrito"
            onClick={onCerrar}
            className="flex h-11 items-center justify-center text-sm font-semibold text-primary"
          >
            Ver carrito completo
          </Link>
        </div>
      </section>
    </div>
  );
}
