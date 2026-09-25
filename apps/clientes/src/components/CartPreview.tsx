"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import { fmtPrecio } from "@/lib/format";

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

// El mismo formateador que la página del carrito y el checkout, con dos
// decimales siempre: el preview es el mismo carrito y tiene que decir los
// mismos números. El de antes tenía `minimumFractionDigits: 0` sin máximo, así
// que $2.344.755,60 salía "$ 2.344.755,6", con un solo decimal.
const fmt = fmtPrecio;

export function CartPreview({
  autoAbrir = true,
  pathname = null,
}: {
  /** Hay dos instancias (header completo y barra compacta): solo la visible se abre sola al agregar. */
  autoAbrir?: boolean;
  /**
   * Ruta actual, la pasa el header. No se lee con `usePathname` acá: en el
   * shell estático de una ruta con parámetros (ficha, pedido) ese hook
   * suspende, y el header se pinta sin ruta (null) hasta que llega el hueco.
   */
  pathname?: string | null;
} = {}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { items, total, count, aperturaPreview } = useCart();

  /**
   * Agregar al carrito (desde una card o desde la ficha) abre el preview unos
   * segundos: el comprador ve qué quedó adentro sin irse de donde está.
   *
   * La apertura se ajusta en el render, no en un efecto: así el dropdown ya
   * sale pintado en el mismo commit del alta, sin un frame de más. El cierre
   * sí va en un efecto, y usa el MISMO ref que el hover, para que el mouse
   * encima lo cancele.
   */
  const [ultimaAlta, setUltimaAlta] = useState(0);
  if (aperturaPreview !== ultimaAlta) {
    setUltimaAlta(aperturaPreview);
    if (autoAbrir) setOpen(true);
  }

  useEffect(() => {
    if (aperturaPreview === 0) return;
    closeTimer.current = setTimeout(() => setOpen(false), 4000);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [aperturaPreview]);

  /**
   * Al navegar se cierra: el header no se desmonta entre páginas, así que sin
   * esto el preview seguía abierto en /carrito o en el checkout.
   */
  const [pathAnterior, setPathAnterior] = useState(pathname);
  if (pathname !== pathAnterior) {
    setPathAnterior(pathname);
    setOpen(false);
  }

  /**
   * El hover abre sólo con mouse. En pantallas táctiles el toque emula un
   * `mouseenter` sin `mouseleave`, y el preview quedaba abierto hasta tocar
   * otra cosa.
   */
  function handlePointerEnter(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function handlePointerLeave(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <div
      className="relative"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {/* Trigger: píldora de tinta con label + chip de count (el total vive
          dentro del popover, no en el header). */}
      <Link
        href="/carrito"
        className="flex items-center gap-2 rounded-full bg-primary px-[18px] py-[9px] text-sm font-semibold text-on-primary transition-colors hover:bg-accent hover:text-white"
      >
        <CartIcon />
        {/* En pantallas chicas queda sólo el ícono + la cantidad: la palabra
            mide 52px y es lo que hace que el carrito no entre al lado de la
            marca en la primera fila del header. El ícono ya dice qué es. */}
        <span className="max-sm:sr-only">Carrito</span>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 text-[11px] font-extrabold">
          {count}
        </span>
      </Link>

      {/* Dropdown. Queda montado siempre para poder animar también el cierre:
          cerrado es `invisible` (fuera del árbol de accesibilidad y sin
          clicks), y `visibility` entra en la transición para que recién se
          oculte al terminar el fade. Crece desde la esquina del botón; con
          reduced motion sólo cambia la opacidad. */}
      <div
        className={`absolute right-0 top-full z-50 mt-3 w-80 origin-top-right overflow-hidden rounded-xl border border-border bg-surface shadow-lg transition-[opacity,scale,visibility] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:scale-100 ${
          open
            ? "visible scale-100 opacity-100 duration-[180ms]"
            : "pointer-events-none invisible scale-[0.96] opacity-0 duration-[120ms]"
        }`}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        {/* Puntero */}
        <div className="absolute -top-[7px] right-6 h-3 w-3 rotate-45 border-l border-t border-border bg-surface" />

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm font-medium text-text">El carrito está vacío</p>
            <Link href="/catalogo" className="text-xs font-semibold text-primary hover:underline">
              Ver catalogo
            </Link>
          </div>
        ) : (
          <>
            <div className="p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Carrito ({count} productos)
              </p>

              {/* `scroll-fino` (utilidad del DS): la misma barra fina y del color de
                  la piel que la lista de marcas, en vez de la gris del sistema.
                  `pr-3` la separa de los precios. */}
              <ul className="scroll-fino -mx-1 max-h-72 space-y-3 overflow-y-auto px-1 pr-3">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/producto/${item.id}`}
                      className="flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-elevated"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted/40">
                        <LightbulbIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-text">{item.name}</p>
                        <p className="text-xs text-muted">{item.qty} u. · {fmt(item.price)} c/u</p>
                      </div>
                      <p className="shrink-0 text-xs font-bold text-text">{fmt(item.price * item.qty)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border px-4 py-3">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-muted">Total</span>
                <span className="font-extrabold text-text">{fmt(total)}</span>
              </div>
              <Link href="/carrito" className="block">
                <Button className="w-full">Ver carrito</Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
