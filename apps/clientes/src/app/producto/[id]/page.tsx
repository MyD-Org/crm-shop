"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Chip,
  PriceTier,
  QuantityStepper,
  Rating,
} from "@myd-org/ui";
import { Footer } from "@/components/Footer";
import { useCart } from "@/context/CartContext";

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

const THUMBNAILS = [0, 1, 2, 3];

const SPECS = [
  { label: "Potencia", value: "48 W" },
  { label: "Tension", value: "220-240 V" },
  { label: "Temperatura de color", value: "6500 K" },
  { label: "Flujo luminoso", value: "4320 lm" },
  { label: "Medidas", value: "595 x 595 mm" },
  { label: "Vida util", value: "30.000 h" },
];

const PRICE_TIERS = [
  { label: "1 - 9 u.", price: 14990 },
  { label: "10 - 49 u.", price: 14240, discount: "-5%" },
  { label: "50+ u.", price: 13490, discount: "-10%" },
];

const TEMP_OPTIONS = ["Fria 6500K", "Neutra 4000K", "Calida 3000K"];

export default function ProductoPage() {
  const [qty, setQty] = useState(1);
  const [selectedTemp, setSelectedTemp] = useState("Fria 6500K");
  const [activeTab, setActiveTab] = useState<"specs" | "desc" | "reviews">("specs");
  const [activeThumb, setActiveThumb] = useState(0);
  const { addItem } = useCart();

  const producto = {
    id: "1",
    name: "Panel LED 48W 60x60 embutir luz fria",
    brand: "Macroled",
    price: 14990,
  };

  return (
    <>
      <main className="mx-auto max-w-7xl flex-1 px-4 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-muted">
          <Link href="/" className="hover:text-primary">Inicio</Link>
          {" / "}
          <Link href="/catalogo?categoria=Iluminacion%20LED" className="hover:text-primary">Iluminacion LED</Link>
          {" / "}
          <span className="text-text">Panel LED 48W</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* Galeria */}
          <div className="flex aspect-square gap-3">
            {/* Thumbnails */}
            <div className="flex flex-col gap-2">
              {THUMBNAILS.map((i) => (
                <button
                  key={i}
                  onClick={() => setActiveThumb(i)}
                  className={`flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-lg border bg-surface transition-colors ${
                    activeThumb === i
                      ? "border-primary"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <LightbulbIcon className="h-10 w-10 text-muted/30" />
                </button>
              ))}
            </div>

            {/* Imagen principal */}
            <div className="relative flex flex-1 items-center justify-center rounded-xl border border-border bg-surface">
              <Badge tone="danger" className="absolute left-3 top-3">-16% OFF</Badge>
              <LightbulbIcon className="h-48 w-48 text-muted/20" />
            </div>
          </div>

          {/* Info */}
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">MACROLED</p>
              <h1 className="mt-1 text-2xl font-extrabold leading-tight text-text">
                Panel LED 48W 60x60 embutir luz fria
              </h1>
              <div className="mt-2 flex items-center gap-3">
                <Rating value={4.8} count={32} />
                <span className="text-xs text-muted">SKU MCL-PNL4860</span>
              </div>
            </div>

            {/* Card de precio */}
            <div className="rounded-xl bg-[linear-gradient(135deg,#0a2550,#143f82)] p-5">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-extrabold text-white">$14.990</span>
                <span className="text-lg text-white/50 line-through">$17.900</span>
                <span className="rounded-md bg-danger px-2 py-0.5 text-sm font-bold text-white">-16%</span>
              </div>
              <p className="mt-1 text-xs text-white/40">
                Precio sin impuestos ${(14990 / 1.21).toLocaleString("es-AR", { maximumFractionDigits: 0 })}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-white/70">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  En stock <span className="text-white/40">—</span> 32 disponibles
                </span>
              </div>
            </div>

            {/* Temperatura de color */}
            <div>
              <p className="mb-2 text-sm font-medium text-text">Temperatura de color</p>
              <div className="flex flex-wrap gap-2">
                {TEMP_OPTIONS.map((t) => (
                  <Chip key={t} selected={t === selectedTemp} onClick={() => setSelectedTemp(t)}>
                    {t}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Cantidad + agregar */}
            <div className="flex items-center gap-3">
              <QuantityStepper value={qty} onValueChange={setQty} min={1} max={999} />
              <Button
                onClick={() => addItem({ ...producto, variant: selectedTemp }, qty)}
                className="flex flex-1 items-center justify-center gap-2"
              >
                <CartIcon />
                Agregar al carrito
              </Button>
            </div>

            {/* Precios por volumen */}
            <PriceTier tiers={PRICE_TIERS} />

          </div>
        </div>

        {/* Tabs */}
        <section className="mt-12">
          <div className="flex gap-1 border-b border-border">
            {(
              [
                ["specs", "Especificaciones"],
                ["desc", "Descripcion"],
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
            {activeTab === "specs" && (
              <table className="w-full max-w-lg text-sm">
                <tbody>
                  {SPECS.map((s, i) => (
                    <tr key={s.label} className={i % 2 === 0 ? "bg-elevated/50" : ""}>
                      <td className="px-3 py-2 font-medium text-muted">{s.label}</td>
                      <td className="px-3 py-2 text-text">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === "desc" && (
              <p className="max-w-prose text-sm leading-relaxed text-muted">
                Panel LED de alto rendimiento para embutir en cielorrasos de durlock.
                Marco blanco, difusor opalino de alta transmitancia. Ideal para oficinas,
                comercios y ambientes que requieren iluminacion uniforme y eficiente. Driver incluido.
              </p>
            )}

            {activeTab === "reviews" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold">4.8</span>
                  <Rating value={4.8} />
                  <span className="text-sm text-muted">32 opiniones</span>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary">
                      JM
                    </div>
                    <div>
                      <p className="text-sm font-medium">Juan M.</p>
                      <p className="text-xs text-muted">Hace 2 semanas</p>
                    </div>
                  </div>
                  <Rating value={5} className="mt-2" />
                  <p className="mt-2 text-sm text-text">
                    Excelente calidad de luz, muy uniforme. Llegaron en 2 dias.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
