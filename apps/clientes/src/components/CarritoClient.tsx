"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { rutaIngreso } from "@/lib/ingreso";
import { Button, QuantityStepper } from "@myd-org/ui";
import type { CartItem } from "@/lib/carrito-cliente";
import { AvisoQuitado } from "@/components/AvisoQuitado";
import { CONFIG_ENVIO_DEFAULT, progresoEnvioGratis, type ConfigEnvio } from "@/lib/envio";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import { useCart } from "@/context/CartContext";
import { resumenDisponibilidadCarrito, sinEntregaPosible } from "@/lib/disponibilidad-textos";
import { useCotizacion } from "@/hooks/useCotizacion";
import { fmtPrecio } from "@/lib/format";
import { CuotasResumen } from "@/components/CuotasResumen";
import { baseCarrito, resumenCuotas } from "@/lib/cuotas-exhibicion";
import { precioLineaCarrito, totalesEstimados } from "@/lib/carrito-precios";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import { EntregaProducto } from "@/components/producto/EntregaProducto";
import { BotonCompartirCarrito } from "@/components/carrito/BotonCompartirCarrito";
import { useChatIa } from "@/hooks/useChatIa";
import { MENSAJES_AL_CHAT, TEXTOS_CARRITO_ASESOR } from "@/lib/iniciativa/textos";

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Una línea recién quitada, con lo necesario para reponerla donde estaba. */
type Quitado = { item: CartItem; indice: number; nombre: string };

/** Lo que dura el colapso de una línea al quitarla, antes de sacarla del carrito. */
const SALIDA_MS = 220;

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
  configEnvio = CONFIG_ENVIO_DEFAULT,
  provincia = null,
}: {
  oferta: OfertaCuotas | null;
  conSesion: boolean;
  /** Configuración de envío del CRM (cacheada: sólo para mostrar; el servidor decide al pedir). */
  configEnvio?: ConfigEnvio;
  /** Provincia conocida del visitante (dirección guardada predeterminada). null = sin ubicación. */
  provincia?: string | null;
}) {
  const { items, updateQty, removeItem: remove, restoreItem, ready } = useCart();
  // "¿Le falta algo?": sólo con el chat montado (spec catálogo asistido fase 2, §3).
  const chat = useChatIa();
  // Líneas que se están yendo: colapsan SALIDA_MS antes de salir del carrito.
  const [saliendo, setSaliendo] = useState<ReadonlySet<string>>(new Set());
  // Bajas que el aviso puede deshacer. Varias seguidas se agrupan en un solo
  // aviso ("Quitó 2 productos") y un solo Deshacer las repone a todas.
  // En un ref: la baja se registra SALIDA_MS después del clic, y dos bajas
  // seguidas no deben pisarse con una copia vieja de la lista.
  const quitados = useRef<Quitado[]>([]);
  const [aviso, setAviso] = useState<{ visible: boolean; texto: string; imagenes: (string | undefined)[]; clave: number }>({
    visible: false,
    texto: "",
    imagenes: [],
    clave: 0,
  });

  /**
   * Mobile: la barra fija "se entrega" al resumen. Cuando la tarjeta del
   * resumen entra en pantalla, la barra baja y se va, y la tarjeta (que tiene
   * el mismo total y el mismo botón) aparece; al volver a subir, al revés. Así
   * nunca se ven dos botones de compra a la vez. La tarjeta conserva su lugar
   * en el flujo: la página no cambia de alto y el scroll no salta.
   */
  const resumenRef = useRef<HTMLElement>(null);
  const [resumenALaVista, setResumenALaVista] = useState(false);
  const hayItems = items.length > 0;
  useEffect(() => {
    const el = resumenRef.current;
    if (!ready || !hayItems || !el) return;
    const obs = new IntersectionObserver(([e]) => setResumenALaVista(e.isIntersecting), {
      threshold: 0.2,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ready, hayItems]);

  /**
   * Quitar con Deshacer: la línea colapsa, sale del carrito y abajo aparece el
   * aviso con Deshacer, que la repone en la misma posición y con la misma
   * cantidad.
   */
  function quitarConDeshacer(item: CartItem, nombreParaMostrar: string) {
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // La posición, contada sin las líneas que todavía están colapsando: esas
    // salen antes que ésta, y Deshacer repone en el orden inverso.
    const indice = items.filter((i) => i.id === item.id || !saliendo.has(i.id)).findIndex((i) => i.id === item.id);
    setSaliendo((s) => new Set(s).add(item.id));
    window.setTimeout(() => {
      remove(item.id);
      setSaliendo((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
      const pila = [...quitados.current.filter((x) => x.item.id !== item.id), { item, indice, nombre: nombreParaMostrar }];
      quitados.current = pila;
      setAviso((a) => ({
        visible: true,
        texto:
          pila.length === 1
            ? `Se quitó ${nombreParaMostrar} del carrito`
            : `Se quitaron ${pila.length} productos del carrito`,
        imagenes: [...pila].reverse().map((q) => q.item.image),
        clave: a.clave + 1,
      }));
    }, reducido ? 0 : SALIDA_MS);
  }

  function cerrarAviso() {
    setAviso((a) => ({ ...a, visible: false }));
    quitados.current = [];
  }

  function deshacer() {
    // Primero se cierra el aviso: un segundo clic ya no tiene dónde caer. Cada
    // índice se tomó sobre la lista tal como estaba en ESA baja, así que se
    // reponen en orden inverso (la última baja primero): deshace paso a paso.
    const pila = quitados.current;
    cerrarAviso();
    for (const q of [...pila].reverse()) restoreItem(q.item, q.indice);
  }

  const avisoQuitado = (sobreBarra: boolean) => (
    <AvisoQuitado
      texto={aviso.texto}
      imagenes={aviso.imagenes}
      visible={aviso.visible}
      clave={aviso.clave}
      sobreBarra={sobreBarra}
      onDeshacer={deshacer}
      onVencer={cerrarAviso}
    />
  );

  // El carrito siempre cotiza como "retiro": la entrega se elige en el checkout.
  const { cotizacion, estado, error, recotizar, ultimasLineas } = useCotizacion({
    entregaTipo: "retiro",
  });

  // Los precios de cada línea salen de la cotización, con IVA como en la ficha
  // (ver precioLineaCarrito): el neto guardado en el carrito no se muestra.
  const lineaDe = (id: string) => cotizacion?.lineas.find((l) => l.id === id);
  // Una sola disponibilidad para todo el pedido (manda el producto más lento), sin las líneas con problema.
  const resumenEntrega = cotizacion?.disponibilidad
    ? resumenDisponibilidadCarrito(
        cotizacion.lineas
          .filter((l) => !l.problema && cotizacion.disponibilidad!.productos[l.id])
          .map((l) => ({
            nombre: nombreConMarca(l.name, l.brand ? formatMarca(l.brand) : undefined).nombre,
            disp: cotizacion.disponibilidad!.productos[l.id],
          })),
        cotizacion.disponibilidad.locales,
      )
    : null;
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
        {avisoQuitado(false)}
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

  // Progreso al envío gratis: el mínimo es sin impuestos, igual que el subtotal. La barra sólo
  // aparece si el envío está activo, el gratis está encendido con un mínimo, y la provincia
  // conocida está en el alcance (sin ubicación o fuera de alcance no se promete nada).
  const progresoEnvio = progresoEnvioGratis(subtotal, provincia, configEnvio);
  const faltaEnvio = progresoEnvio ? progresoEnvio.faltante : null;
  const pctEnvio = progresoEnvio?.pct ?? 0;

  const lineasConProblema = cotizacion?.lineas.filter((l) => l.problema).length ?? 0;

  const botonCompra = (etiquetaBloqueado?: string) => (
    <Link href="/checkout" className="block" aria-disabled={cotizacion?.hayProblemas || undefined}>
      <Button className="w-full" disabled={cotizacion?.hayProblemas}>
        {cotizacion?.hayProblemas && etiquetaBloqueado ? etiquetaBloqueado : "Iniciar compra"}
      </Button>
    </Link>
  );

  return (
    <>
      <main className="mx-auto w-full max-w-contenido flex-1 px-4 pt-6 lg:pb-16 lg:pt-8">
        <div className="mb-5 flex items-center gap-3 lg:mb-6">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-[26px] font-semibold tracking-tight text-text lg:text-[32px]">Carrito</h1>
            <span className="text-sm font-semibold text-muted">
              {unidadesCarrito} {unidadesCarrito === 1 ? "producto" : "productos"}
            </span>
          </div>
          <div className="ml-auto">
            <BotonCompartirCarrito items={items} />
          </div>
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

        {cotizacion?.listaPreferencial && (
          <div className="mb-6 flex items-start gap-3 rounded-[20px] border border-accent/30 bg-accent/5 p-4 text-sm">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white" aria-hidden="true">
              <CheckIcon />
            </span>
            <p className="text-text">
              <span className="font-semibold">Su cuenta tiene precios preferenciales.</span>{" "}
              <span className="text-muted">Los importes del carrito ya los incluyen.</span>
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
          {/* Items: una tarjeta por producto. Al quitar, la fila colapsa
              (grid-rows 1fr → 0fr) y la de abajo sube a su lugar. */}
          <ul className="flex flex-col">
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
              const { nombre: nombreParaMostrar } = nombreConMarca(nombre, marca ? formatMarca(marca) : undefined);
              const seVa = saliendo.has(item.id);

              return (
                <li
                  key={item.id}
                  aria-hidden={seVa || undefined}
                  className={`grid transition-[grid-template-rows,opacity] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
                    seVa ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
                  }`}
                >
                  {/* overflow-hidden sólo mientras colapsa: siempre puesto, recorta
                      la sombra de la tarjeta (y la de hover, que baja 24 px). */}
                  <div className={`min-h-0 ${seVa ? "overflow-hidden" : ""}`}>
                    <div className="pb-3">
                      <article
                        className={`grid grid-cols-[72px_minmax(0,1fr)_40px] gap-x-4 gap-y-3 rounded-[22px] bg-surface p-4 shadow-[var(--shadow-1)] transition-[box-shadow,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-px hover:shadow-[0_8px_20px_-10px_var(--color-border-strong)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:grid-cols-[104px_minmax(0,1fr)_40px] lg:gap-x-5 lg:p-[18px] ${
                          linea?.problema ? "outline-2 outline-highlight" : ""
                        }`}
                      >
                        <Link
                          href={`/producto/${item.id}`}
                          tabIndex={-1}
                          aria-hidden="true"
                          className="relative flex h-[72px] w-[72px] shrink-0 items-center self-start justify-center overflow-hidden rounded-2xl bg-elevated lg:row-span-2 lg:h-[104px] lg:w-[104px]"
                        >
                          {item.image ? (
                            <Image src={item.image} alt="" fill sizes="104px" className="object-contain p-2" />
                          ) : (
                            <LightbulbIcon className="h-10 w-10 text-accent" />
                          )}
                        </Link>

                        <div className="flex min-w-0 flex-col gap-1.5">
                          {marca && (
                            <p className="text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-accent">
                              {formatMarca(marca)}
                            </p>
                          )}
                          <Link
                            href={`/producto/${item.id}`}
                            className="break-words text-[15px] font-extrabold leading-snug text-text underline-offset-[3px] hover:text-accent hover:underline lg:text-[17px]"
                          >
                            {nombreParaMostrar}
                          </Link>
                          {item.variant && <p className="text-xs text-muted">{item.variant}</p>}
                          {/* Mobile: el unitario va acá; al lado del stepper no entra con el total. */}
                          {precio && (
                            <p className="text-[13px] tabular-nums text-muted lg:hidden">
                              {item.qty} × {fmtPrecio(precio.unitario)}
                            </p>
                          )}
                          {linea?.problema && (
                            <p className="flex items-center gap-1.5 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] font-bold text-warning">
                              <AlertIcon />
                              {linea.detalle}
                            </p>
                          )}
                          {/* Flag `disponibilidad-sucursal`: el detalle por local va una sola vez en el
                              resumen; acá sólo el aviso de que no se puede de ninguna forma. */}
                          {!linea?.problema &&
                            cotizacion?.disponibilidad?.productos[item.id] &&
                            sinEntregaPosible(cotizacion.disponibilidad.productos[item.id]) && (
                              <p className="flex items-center gap-1.5 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] font-bold text-warning">
                                <AlertIcon />
                                Sin stock para retiro ni envío
                              </p>
                            )}
                        </div>

                        <button
                          type="button"
                          onClick={() => quitarConDeshacer(item, nombreParaMostrar)}
                          disabled={seVa}
                          className="-mr-1.5 -mt-1.5 flex h-10 w-10 items-center justify-center self-start rounded-xl text-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                          aria-label={`Quitar ${nombreParaMostrar} del carrito`}
                        >
                          <TrashIcon />
                        </button>

                        {/* Cantidad y total en una fila propia: así el nombre sólo
                            comparte el ancho con la papelera, no con el total. En
                            mobile ocupa todo el ancho de la tarjeta. */}
                        <div className="col-span-3 flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2 lg:col-span-2 lg:col-start-2">
                          <div className="flex items-center gap-3.5">
                            <QuantityStepper
                              value={item.qty}
                              onValueChange={(qty) => updateQty(item.id, qty)}
                              min={1}
                              max={linea?.stockDisponible ?? 999}
                              // El contador de todo el sitio. Sin tacho: quitar
                              // tiene su propio botón, con Deshacer.
                              tone="soft"
                            />
                            {precio ? (
                              <span className="hidden text-[13px] tabular-nums text-muted lg:inline">
                                {item.qty} × {fmtPrecio(precio.unitario)}
                              </span>
                            ) : (
                              estado === "cargando" && <span className="text-[13px] text-muted">Calculando…</span>
                            )}
                          </div>
                          {precio && (
                            <p
                              className={`font-display text-base font-semibold tabular-nums lg:text-xl ${
                                linea?.problema ? "text-muted line-through" : "text-text"
                              }`}
                            >
                              {fmtPrecio(precio.total)}
                            </p>
                          )}
                        </div>
                      </article>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Resumen */}
          <aside
            ref={resumenRef}
            className={`h-fit space-y-5 rounded-[22px] bg-surface p-5 shadow-[var(--shadow-1)] transition-[opacity,translate] duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none lg:sticky lg:top-24 lg:translate-y-0 lg:p-6 lg:opacity-100 ${
              resumenALaVista ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            {faltaEnvio !== null && (
              <div className="space-y-2.5 rounded-2xl bg-bg p-4" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-bold text-text">
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white transition-[scale,opacity] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
                      faltaEnvio === 0 ? "scale-100 opacity-100" : "scale-[0.6] opacity-0"
                    }`}
                    aria-hidden="true"
                  >
                    <CheckIcon />
                  </span>
                  {faltaEnvio === 0
                    ? "Su compra tiene envío a domicilio gratis"
                    : `Le faltan ${fmtPrecio(faltaEnvio)} sin impuestos para el envío gratis`}
                </p>
                <div
                  role="progressbar"
                  aria-label="Progreso hacia el envío gratis"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pctEnvio}
                  className="h-2 overflow-hidden rounded-full bg-elevated"
                >
                  <div
                    className="h-full rounded-full bg-success transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                    style={{ width: `${pctEnvio}%` }}
                  />
                </div>
              </div>
            )}

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
              {total === null ? (
                <span className="text-sm font-medium text-muted">{textoTotal}</span>
              ) : (
                <span className="font-display text-[28px] font-bold tracking-tight tabular-nums text-text">
                  {fmtPrecio(total)}
                </span>
              )}
            </div>

            <CuotasResumen resumen={resumen} />

            {cotizacion?.hayProblemas && (
              <p className="rounded-lg bg-danger/5 p-3 text-xs text-danger">
                Revise los productos marcados antes de continuar.
              </p>
            )}

            {/* También en mobile: cuando el resumen está a la vista, la barra fija se va. */}
            <div className="space-y-3">
              {botonCompra()}
              <Link href="/catalogo" className="block text-center text-sm font-semibold text-accent hover:underline">
                Seguir comprando
              </Link>
              {/* Enlace discreto al asesor: abre el chat pidiéndole que revise
                  el carrito (el contexto de pantalla ya lleva las líneas). */}
              {chat.disponible && items.length > 0 && (
                <p className="text-center text-sm text-muted">
                  {TEXTOS_CARRITO_ASESOR.pregunta}{" "}
                  <button
                    type="button"
                    onClick={() => chat.conversar(MENSAJES_AL_CHAT.carrito)}
                    className="font-semibold text-text underline decoration-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
                  >
                    {TEXTOS_CARRITO_ASESOR.accion}
                  </button>
                </p>
              )}
            </div>

            <EntregaProducto
              configEnvio={configEnvio}
              provincia={provincia}
              disponibilidad={resumenEntrega ? { producto: resumenEntrega.producto, locales: cotizacion!.disponibilidad!.locales } : undefined}
              detallePorLocal={resumenEntrega?.detallePorLocal}
              ubicacionConocida={provincia !== null}
            />
          </aside>
        </div>

        {/* Barra de compra en mobile: sticky y última del main, acompaña el
            scroll y se detiene donde empieza el footer. */}
        <div
          data-sin-footer-mobile
          data-barra-compra
          aria-hidden={resumenALaVista || undefined}
          inert={resumenALaVista || undefined}
          className={`sticky bottom-0 z-30 -mx-4 mt-8 flex items-center gap-4 rounded-t-[20px] border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none lg:hidden ${
            resumenALaVista ? "pointer-events-none translate-y-full opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          <div className="min-w-0 shrink-0">
            {total === null ? (
              <p className="font-display text-lg font-bold text-muted">{textoTotal}</p>
            ) : (
              <p className="font-display text-lg font-bold tabular-nums text-text">{fmtPrecio(total)}</p>
            )}
            {resumen?.mejor && (
              <p className={`text-xs font-bold ${resumen.mejor.sinInteres ? "text-success" : "text-muted"}`}>
                {TEXTOS_CUOTAS.linea(resumen.mejor.cuotas, resumen.mejor.montoCuota, resumen.mejor.sinInteres)}
              </p>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {botonCompra(
              lineasConProblema === 1 ? "Revise 1 producto" : `Revise ${lineasConProblema} productos`,
            )}
          </div>
        </div>
      </main>
      {/* Mobile: sobre la barra fija, salvo que se haya retirado por el resumen. */}
      {avisoQuitado(!resumenALaVista)}
    </>
  );
}
