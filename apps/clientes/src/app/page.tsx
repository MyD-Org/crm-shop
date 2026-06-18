"use client";

import Link from "next/link";
import Image from "next/image";
import { Badge, Button, ProductCard } from "@myd-org/ui";
import { Footer } from "@/components/Footer";
import { AddToCartButton } from "@/components/AddToCartButton";
import { PRODUCTS } from "@/data/products";

/* ── Icons ─────────────────────────────────────────────── */

function TruckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}
function StoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function CreditCardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}
function WhatsAppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" /><path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* ── Data ───────────────────────────────────────────────── */

const CATEGORIES = [
  { label: "Iluminación LED", count: 1240 },
  { label: "Lámparas y tubos", count: 860 },
  { label: "Tableros y protección", count: 540 },
  { label: "Cables y Conductores", count: 320 },
  { label: "Tomas y módulos", count: 410 },
  { label: "Tiras LED y perfiles", count: 190 },
  { label: "Automatización", count: 150 },
  { label: "Herramientas", count: 280 },
];

const DESTACADOS = PRODUCTS.slice(0, 4);

/* ── Page ───────────────────────────────────────────────── */

export default function Home() {
  return (
    <>


      <main className="flex-1">
        {/* ── Hero ──────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#07193a]">
          <div className="absolute inset-0 bg-[radial-gradient(820px_380px_at_80%_18%,rgba(46,168,255,0.3),transparent_60%),radial-gradient(640px_460px_at_6%_100%,rgba(23,99,214,0.34),transparent_60%)]" />

          <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-16 lg:grid-cols-2 lg:py-20">
            {/* Left */}
            <div className="flex flex-col justify-center">
              <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#92d1ff]/30 bg-white/[0.08] px-[13px] py-1.5 text-xs font-bold text-[#9ed0ff]">
                <span className="h-[7px] w-[7px] rounded-full bg-info" />
                Nueva línea LED 2026
              </span>

              <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-[56px]">
                Iluminá tu proyecto con{" "}
                <span className="text-white">tecnología LED</span>
              </h1>

              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60">
                Materiales eléctricos e iluminación con stock real y marcas
                líderes. Precios mayoristas para profesionales y comercios.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/catalogo">
                  <Button className="h-12 rounded-[12px] bg-[linear-gradient(120deg,#1763d6,#2ea8ff)] px-7 text-base shadow-[0_14px_30px_-10px_rgba(46,168,255,0.6)] hover:opacity-95">
                    Ver catálogo
                  </Button>
                </Link>
                <Link href="/ofertas">
                  <Button
                    variant="ghost"
                    className="h-12 rounded-[12px] border-[1.5px] border-white/[0.28] bg-white/[0.06] px-6 text-base font-bold text-white hover:bg-white/15"
                  >
                    Ofertas de la semana
                  </Button>
                </Link>
              </div>

              {/* Stats */}
              <div className="mt-10 flex gap-8">
                {[
                  ["+5.000", "productos"],
                  ["+40", "marcas"],
                  ["24 h", "despacho"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <span className="text-2xl font-bold text-info">
                      {value}
                    </span>
                    <span className="block text-xs text-white/50">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — illustration card */}
            <div className="relative hidden lg:block">
              {/* Card */}
              <div className="relative flex h-full min-h-[360px] overflow-hidden rounded-3xl border border-white/10">
                <Image
                  src="/products.jpg"
                  alt="Productos"
                  fill
                  className="object-cover"
                />
              </div>

              {/* Badge */}
              <div className="absolute -right-4 -top-4 rotate-3 rounded-full bg-danger px-5 py-2 text-sm font-extrabold tracking-wide text-white shadow-2">
                Precios por mayor
              </div>

              {/* Stock card */}
              <div className="absolute -bottom-6 -left-6 flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft">
                  <CheckIcon />
                </div>
                <div>
                  <p className="text-sm font-bold text-text">
                    Stock en tiempo real
                  </p>
                  <p className="text-xs text-muted">Sincronizado al instante</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Benefits bar ─────────────────────────────── */}
        <section className="bg-surface-darker">
          <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-white/10 lg:grid-cols-4">
            {[
              { icon: <TruckIcon />, text: "Envío gratis", sub: "+$100.000" },
              { icon: <StoreIcon />, text: "Retiro en local", sub: "sin cargo" },
              { icon: <CreditCardIcon />, text: "Cuenta corriente", sub: "B2B" },
              {
                icon: <WhatsAppIcon />,
                text: "WhatsApp",
                sub: "asesoramiento",
                accent: true,
              },
            ].map((b) => (
              <div
                key={b.text}
                className="flex items-center gap-3 px-6 py-4"
              >
                <span className={b.accent ? "text-success" : "text-info"}>
                  {b.icon}
                </span>
                <p className="text-sm">
                  <span className="font-semibold text-white">{b.text}</span>{" "}
                  <span className="text-white/50">{b.sub}</span>
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Explorá por rubro ────────────────────────── */}
        <section className="mx-auto max-w-7xl px-4 py-14">
          <div className="mb-2 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-extrabold text-text">
                Explorá por rubro
              </h2>
              <p className="mt-1 text-sm text-muted">
                Todo para tu instalación, ordenado por categoría
              </p>
            </div>
            <Link
              href="/catalogo"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Ver todas →
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.label}
                href={`/catalogo?categoria=${encodeURIComponent(cat.label)}`}
              >
                <div className="group relative flex min-h-[80px] flex-col overflow-hidden rounded-[15px] bg-[linear-gradient(135deg,#0a2550,#143f82)] p-[14px] transition-transform hover:scale-[1.02]">
                  {/* glow radial sutil */}
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_28%,rgba(92,198,255,0.14),transparent_55%)]" />
                  {/* ícono en caja */}
                  <div className="relative flex h-10 w-10 items-center justify-center rounded-[11px] bg-info/[0.14]">
                    <LightbulbIcon className="h-5 w-5 text-info" />
                  </div>
                  <div className="relative mt-auto pt-4">
                    <p className="text-sm font-semibold text-white">
                      {cat.label}
                    </p>
                    <p className="mt-0.5 text-xs text-white/50">
                      {cat.count.toLocaleString("es-AR")} art.
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Lo más vendido ───────────────────────────── */}
        <section className="mx-auto max-w-7xl px-4 pb-14">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-2xl font-extrabold text-text">
              Lo más vendido
            </h2>
            <Link
              href="/catalogo?orden=ventas"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Ver todos →
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {DESTACADOS.map((p) => (
              <Link key={p.id} href={`/producto/${p.id}`}>
                <ProductCard
                  name={p.name}
                  brand={p.brand}
                  price={p.price}
                  oldPrice={p.oldPrice}
                  stock={p.stock}
                  badge={
                    p.badgeText ? (
                      <Badge tone={p.badgeTone}>{p.badgeText}</Badge>
                    ) : undefined
                  }
                  image={<LightbulbIcon className="h-20 w-20 text-muted/25" />}
                  action={<AddToCartButton product={{ id: p.id, name: p.name, brand: p.brand, price: p.price }} />}
                />
              </Link>
            ))}
          </div>
        </section>

        {/* ── WhatsApp CTA ─────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-4 pb-14">
          <div className="relative flex items-center justify-between gap-6 overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#0a2550,#1763d6)] px-8 py-8 sm:px-12">
            {/* Cyan glow top-right */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_200px_at_88%_0%,rgba(46,168,255,0.3),transparent_60%)]" />
            <div className="relative flex items-center gap-5">
              <ChatIcon />
              <div>
                <p className="text-lg font-bold text-white">
                  ¿Necesitás asesoramiento técnico?
                </p>
                <p className="text-sm text-white/70">
                  Escribinos por WhatsApp y te ayudamos a elegir el producto
                  correcto.
                </p>
              </div>
            </div>
            <button className="relative shrink-0 rounded-full border-2 border-white px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-primary">
              Consultar ahora
            </button>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
