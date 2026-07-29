"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, PriceTier, QuantityStepper } from "@myd-org/ui";
import { Footer } from "@/components/Footer";
import { useCart } from "@/context/CartContext";
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
 * capa propia del shop (ver docs/arquitectura-integraciones.md).
 */
export function ProductoClient({ producto }: { producto: Product }) {
  const [qty, setQty] = useState(1);
  const [activeTab, setActiveTab] = useState<"specs" | "desc" | "reviews">("desc");
  const { addItem } = useCart();

  const estado = ESTADO_STOCK[producto.stock];
  const agotado = producto.stock === "out";

  return (
    <>
      <main className="mx-auto max-w-7xl flex-1 px-4 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-muted">
          <Link href="/" className="hover:text-primary">Inicio</Link>
          {producto.category && (
            <>
              {" / "}
              <Link
                href={`/catalogo?categoria=${encodeURIComponent(producto.category)}`}
                className="hover:text-primary"
              >
                {producto.category}
              </Link>
            </>
          )}
          {" / "}
          <span className="text-text">{producto.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* Galeria — Alegra no expone imagenes todavia */}
          <div className="flex aspect-square gap-3">
            <div className="relative flex flex-1 items-center justify-center rounded-xl border border-border bg-surface">
              <LightbulbIcon className="h-48 w-48 text-muted/20" />
            </div>
          </div>

          {/* Info */}
          <div className="space-y-5">
            <div>
              {producto.brand && (
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  {producto.brand}
                </p>
              )}
              <h1 className="mt-1 text-2xl font-extrabold leading-tight text-text">
                {producto.name}
              </h1>
              {producto.sku && (
                <div className="mt-2">
                  <span className="text-xs text-muted">SKU {producto.sku}</span>
                </div>
              )}
            </div>

            {/* Card de precio */}
            <div className="rounded-xl bg-[linear-gradient(135deg,#0a2550,#143f82)] p-5">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-extrabold text-white">
                  ${producto.price.toLocaleString("es-AR")}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-white/70">
                  <span className={`h-2 w-2 rounded-full ${estado.color}`} />
                  {estado.texto}
                  {producto.stockQty != null && (
                    <>
                      <span className="text-white/40">—</span>
                      {producto.stockQty} disponibles
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* Variantes — sin datos en Alegra */}
            <div>
              <p className="mb-2 text-sm font-medium text-text">Variantes</p>
              <SinDatos>Este producto no tiene variantes cargadas.</SinDatos>
            </div>

            {/* Cantidad + agregar */}
            <div className="flex items-center gap-3">
              <QuantityStepper value={qty} onValueChange={setQty} min={1} max={999} />
              <Button
                onClick={() => addItem(producto, qty)}
                disabled={agotado}
                className="flex flex-1 items-center justify-center gap-2"
              >
                <CartIcon />
                {agotado ? "Sin stock" : "Agregar al carrito"}
              </Button>
            </div>

            {/* Precios por volumen — sin listas de precios cargadas todavia */}
            <div>
              <p className="mb-2 text-sm font-medium text-text">Precio por cantidad</p>
              <SinDatos>No hay precios por volumen cargados.</SinDatos>
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

      <Footer />
    </>
  );
}
