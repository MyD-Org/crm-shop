"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, QuantityStepper } from "@myd-org/ui";
import { PrecioConImpuestos } from "@/components/PrecioConImpuestos";
import { CuotasLinea } from "@/components/CuotasLinea";
import { MediosDePagoModal } from "@/components/MediosDePagoModal";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import { formatRubro } from "@/lib/formato-rubro";
import { textoUnidadesDisponibles } from "@/lib/catalogo-vista";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import { useCart } from "@/context/CartContext";
import { BotonFavorito } from "@/components/BotonFavorito";
import { BotonCompartir } from "@/components/BotonCompartir";
import type { Product } from "@/data/products";

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

/** Placeholder para las secciones que Alegra todavia no alimenta. */
function SinDatos({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

const ESTADO_STOCK: Record<Product["stock"], { texto: string; color: string }> = {
  in: { texto: "En stock", color: "bg-success" },
  low: { texto: "Ultimas unidades", color: "bg-warning" },
  out: { texto: "Sin stock", color: "bg-danger" },
};

/**
 * Ficha de producto. Los datos llegan resueltos desde Alegra via el Server
 * Component `producto/[id]/page.tsx`.
 *
 * Alegra provee: nombre, marca, SKU, descripcion, precio, stock y categoria.
 * NO provee imagenes, especificaciones, opiniones, variantes ni precios por
 * volumen: esas secciones se mantienen visibles pero vacias, a la espera de la
 * capa propia del shop (ver docs/arquitectura-integraciones.md). Variantes y
 * precio por cantidad son la excepcion: sin datos no se dibuja nada, porque un
 * bloque que siempre dice "no hay" no le sirve a nadie.
 */
export function ProductoClient({
  producto,
  oferta = null,
}: {
  producto: Product;
  /** Oferta de cuotas resuelta en el server. null = no se muestran cuotas. */
  oferta?: OfertaCuotas | null;
}) {
  const [qty, setQty] = useState(1);
  const [activeTab, setActiveTab] = useState<"specs" | "desc" | "reviews">("desc");
  const { addItem } = useCart();

  // Cuotas sobre el precio final unitario: sin IVA conocido no se calcula nada.
  const mejorCuota = mejorOpcionPara(producto.precioFinal, oferta);

  const estado = ESTADO_STOCK[producto.stock];
  const agotado = producto.stock === "out";
  // Sin cantidad si es 0 o menos (pasa con la simulación de stock): nada de
  // "En stock — 0 disponibles".
  const disponibles = textoUnidadesDisponibles(producto);
  // Un ítem sin precio en Alegra llega a 0: nunca se ofrece a la venta (ver
  // `conPrecioSql` en src/lib/catalog.ts). La ficha se lee en vivo, así que el
  // filtro de los listados no la cubre y hay que cortar acá también.
  const sinPrecio = !(producto.price > 0);

  return (
    <>
      <main className="mx-auto max-w-contenido flex-1 px-4 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-muted">
          <Link href="/" className="text-muted transition-colors hover:text-accent">Inicio</Link>
          {producto.category && (
            <>
              {" / "}
              <Link
                href={`/catalogo?categoria=${encodeURIComponent(producto.category)}`}
                className="text-muted transition-colors hover:text-accent"
              >
                {formatRubro(producto.category)}
              </Link>
            </>
          )}
          {" / "}
          <span className="text-text">{producto.name}</span>
        </nav>

        {/* Galería un poco más angosta que la info: los nombres de Alegra son
            largos y necesitan el ancho más que la foto. */}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* Galeria — Alegra no expone imagenes todavia */}
          <div className="flex aspect-square gap-3">
            <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[24px] bg-elevated">
              <LightbulbIcon className="h-48 w-48 text-muted/20" />
            </div>
          </div>

          {/* Info */}
          <div className="space-y-5">
            {/* Compartir junto al título y no en la fila de compra: en mobile esa
                fila ya va justa y "Agregar al carrito" se partía en dos líneas. */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {producto.brand && (
                  <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                    {producto.brand}
                  </p>
                )}
                {/* Tamaño contenido: los nombres vienen de Alegra, largos y en
                    mayúsculas; a 4xl ocupaban cinco líneas. */}
                <h1 className="mt-1 font-display text-2xl font-medium leading-tight tracking-tight text-text md:text-[28px]">
                  {producto.name}
                </h1>
                {producto.sku && (
                  <div className="mt-2">
                    <span className="text-xs text-muted">SKU {producto.sku}</span>
                  </div>
                )}
              </div>
              <BotonCompartir titulo={producto.name} />
            </div>

            {/* Card de precio */}
            <div className="rounded-[24px] border border-border bg-surface p-6">
              {sinPrecio ? (
                <p className="text-lg font-semibold text-muted">
                  Precio no disponible. Consulte por WhatsApp o por teléfono.
                </p>
              ) : (
                <PrecioConImpuestos price={producto.price} precioFinal={producto.precioFinal} />
              )}
              {!sinPrecio && mejorCuota && oferta && producto.precioFinal != null && (
                <div className="mt-3 border-t border-border pt-3">
                  <CuotasLinea opcion={mejorCuota} tono="claro" tamano="lg" className="block" />
                  <MediosDePagoModal
                    precioFinal={producto.precioFinal}
                    oferta={oferta}
                    className="mt-1 text-primary transition-colors hover:text-accent"
                  />
                </div>
              )}
              <div className="mt-3 flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <span className={`h-2 w-2 rounded-full ${estado.color}`} />
                  {estado.texto}
                  {disponibles && (
                    <>
                      <span className="text-muted/60">—</span>
                      {disponibles}
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* Cantidad + agregar */}
            <div className="flex items-center gap-3">
              <QuantityStepper value={qty} onValueChange={setQty} min={1} max={999} />
              <Button
                onClick={() => addItem(producto, qty)}
                disabled={agotado || sinPrecio}
                className="flex flex-1 items-center justify-center gap-2"
              >
                <CartIcon />
                {sinPrecio ? "Consulte el precio" : agotado ? "Sin stock" : "Agregar al carrito"}
              </Button>
              <BotonFavorito productId={producto.id} />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <section className="mt-12">
          <div className="flex gap-1 border-b border-border">
            {(
              [
                ["desc", "Descripcion"],
                ["specs", "Especificaciones"],
                ["reviews", "Opiniones"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === key
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="py-6">
            {activeTab === "desc" &&
              (producto.description ? (
                <p className="max-w-prose text-sm leading-relaxed text-muted">
                  {producto.description}
                </p>
              ) : (
                <SinDatos>Este producto no tiene descripcion cargada.</SinDatos>
              ))}

            {activeTab === "specs" && (
              <SinDatos>Este producto no tiene especificaciones cargadas.</SinDatos>
            )}

            {activeTab === "reviews" && (
              <SinDatos>Todavia no hay opiniones de este producto.</SinDatos>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
