"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Checkbox, Chip, ProductCard, Select } from "@myd-org/ui";
import { Footer } from "@/components/Footer";
import { AddToCartButton } from "@/components/AddToCartButton";
import { CuotasCard } from "@/components/CuotasCard";
import type { Product } from "@/data/products";
import type { Facetas } from "@/lib/catalog";
import {
  hrefCon,
  paginasVisibles,
  type EstadoCatalogo,
  type OrdenCatalogo,
} from "@/lib/catalogo-url";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import type { OfertaCuotas, OpcionCuotas } from "@/lib/pagos/cuotas-tipos";

/** Precio principal que ve el visitante: final con IVA si se conoce, si no el de siempre. */
const precioExhibido = (p: Product) => p.precioFinal ?? p.price;

const SORT_OPTIONS: { label: string; value: OrdenCatalogo }[] = [
  { label: "Más vendidos", value: "ventas" },
  { label: "Precio: menor a mayor", value: "precio-asc" },
  { label: "Precio: mayor a menor", value: "precio-desc" },
  { label: "Nombre A-Z", value: "nombre" },
];

/**
 * UI del catálogo (filtros, orden, paginación).
 *
 * El filtrado, el orden y el conteo ya NO pasan por acá: los resuelve Postgres
 * y llegan resueltos desde `catalogo/page.tsx`. Este componente sólo traduce lo
 * que toca el visitante a una URL nueva, porque el estado del catálogo vive en
 * la query string (ver src/lib/catalogo-url.ts).
 */
export function CatalogoClient({
  productos,
  facetas,
  estado,
  total,
  paginas,
  oferta = null,
}: {
  /** Sólo la página actual, nunca el catálogo entero. */
  productos: Product[];
  facetas: Facetas;
  /** Filtros, orden y página vigentes, tal como los leyó el servidor. */
  estado: EstadoCatalogo;
  /** Productos que cumplen los filtros, más allá de esta página. */
  total: number;
  paginas: number;
  /** Oferta de cuotas resuelta en el server. null = no se muestran cuotas. */
  oferta?: OfertaCuotas | null;
}) {
  const router = useRouter();
  // Navegar es un round-trip al servidor: mientras tanto, la grilla se atenúa
  // en vez de quedarse muda.
  const [navegando, startTransition] = useTransition();

  const ir = (cambios: Parameters<typeof hrefCon>[1]) =>
    startTransition(() => router.push(hrefCon(estado, cambios)));

  // Mejor opción de cuotas por producto, sobre su precio final unitario.
  const cuotasPorProducto = useMemo(() => {
    const m = new Map<string, OpcionCuotas>();
    if (!oferta) return m;
    for (const p of productos) {
      const mejor = mejorOpcionPara(p.precioFinal, oferta);
      if (mejor) m.set(p.id, mejor);
    }
    return m;
  }, [productos, oferta]);

  const toggleCategoria = (label: string) =>
    ir({
      categorias: estado.categorias.includes(label)
        ? estado.categorias.filter((x) => x !== label)
        : [...estado.categorias, label],
    });

  const toggleMarca = (label: string) =>
    ir({
      marcas: estado.marcas.includes(label)
        ? estado.marcas.filter((x) => x !== label)
        : [...estado.marcas, label],
    });

  /** Chips de filtros activos: categorías y marcas juntas, como las ve el visitante. */
  const chips = [
    ...estado.categorias.map((label) => ({ label, quitar: () => toggleCategoria(label) })),
    ...estado.marcas.map((label) => ({ label, quitar: () => toggleMarca(label) })),
  ];

  return (
    <>
      <main className="mx-auto flex max-w-contenido flex-1 gap-6 px-4 py-8">
        {/* Sidebar filtros */}
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Categorías
              </h3>
              <ul className="space-y-2">
                {facetas.categorias.map((c) => (
                  <li key={c.label}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={estado.categorias.includes(c.label)}
                        onCheckedChange={() => toggleCategoria(c.label)}
                      />
                      <span className="flex-1">{c.label}</span>
                      <span className="text-xs text-muted">{c.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Marcas
              </h3>
              <ul className="space-y-2">
                {facetas.marcas.map((b) => (
                  <li key={b.label}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={estado.marcas.includes(b.label)}
                        onCheckedChange={() => toggleMarca(b.label)}
                      />
                      <span className="flex-1">{b.label}</span>
                      <span className="text-xs text-muted">{b.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* Contenido principal */}
        <div className="flex-1">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold text-text">
                {estado.query ? `Resultados para "${estado.query}"` : "Catálogo"}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {total === 0
                  ? "Sin productos"
                  : paginas > 1
                    ? `${total} productos · página ${estado.pagina} de ${paginas}`
                    : `${total} productos`}
              </p>
            </div>
            <Select
              options={SORT_OPTIONS}
              value={estado.orden}
              onValueChange={(v) => ir({ orden: v as OrdenCatalogo })}
              aria-label="Ordenar productos"
              className="w-52"
            />
          </div>

          {chips.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <Chip key={c.label} variant="removable" onRemove={c.quitar}>
                  {c.label}
                </Chip>
              ))}
              <button
                onClick={() => ir({ categorias: [], marcas: [] })}
                className="text-xs font-medium text-primary hover:underline"
              >
                Limpiar todo
              </button>
            </div>
          )}

          {productos.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">
              No se encontraron productos.
            </p>
          ) : (
            <div
              // Mientras el server arma la página siguiente, la grilla vigente
              // se atenúa: el visitante ve que algo está pasando.
              className={`grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 ${
                navegando ? "opacity-50" : ""
              }`}
              aria-busy={navegando}
            >
              {productos.map((p) => (
                <Link key={p.id} href={`/producto/${p.id}`}>
                  <ProductCard
                    name={p.name}
                    brand={p.brand}
                    price={precioExhibido(p)}
                    oldPrice={p.oldPrice}
                    discount={p.discount}
                    stock={p.stock}
                    badge={
                      p.badgeText ? (
                        <Badge tone={p.badgeTone}>{p.badgeText}</Badge>
                      ) : undefined
                    }
                    image={<div className="text-5xl opacity-40">💡</div>}
                    action={
                      <AddToCartButton
                        disabled={p.stock === "out"}
                        product={{ id: p.id, name: p.name, brand: p.brand, price: p.price }}
                      />
                    }
                    installments={<CuotasCard opcion={cuotasPorProducto.get(p.id) ?? null} />}
                  />
                </Link>
              ))}
            </div>
          )}

          <Paginacion estado={estado} paginas={paginas} />
          {/* Sólo para lectores de pantalla: el cambio de página no mueve el foco. */}
          <p className="sr-only" role="status">
            {total === 0
              ? "Sin resultados"
              : `Mostrando ${productos.length} de ${total} productos, página ${estado.pagina} de ${paginas}`}
          </p>
        </div>
      </main>

      <Footer />
    </>
  );
}

/** Estilo compartido por todos los controles de la barra de paginación. */
const CELDA =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm";

/**
 * Barra de páginas numeradas. Son `<Link>`, no botones: cada página es una URL
 * real, así que se puede compartir, abrir en otra pestaña e indexar.
 */
function Paginacion({
  estado,
  paginas,
}: {
  estado: EstadoCatalogo;
  paginas: number;
}) {
  if (paginas <= 1) return null;

  const { pagina } = estado;
  const flecha = (destino: number, etiqueta: string, simbolo: string) =>
    destino >= 1 && destino <= paginas ? (
      <Link
        href={hrefCon(estado, { pagina: destino })}
        aria-label={etiqueta}
        className={`${CELDA} border-border hover:border-primary hover:text-primary`}
      >
        {simbolo}
      </Link>
    ) : (
      <span
        aria-hidden
        className={`${CELDA} border-border text-muted opacity-40`}
      >
        {simbolo}
      </span>
    );

  return (
    <nav aria-label="Paginación del catálogo" className="mt-8 flex justify-center">
      <ul className="flex flex-wrap items-center gap-1">
        <li>{flecha(pagina - 1, "Página anterior", "‹")}</li>
        {paginasVisibles(pagina, paginas).map((n, i) =>
          n == null ? (
            <li key={`gap-${i}`} aria-hidden className="px-1 text-sm text-muted">
              …
            </li>
          ) : (
            <li key={n}>
              {n === pagina ? (
                <span
                  aria-current="page"
                  className={`${CELDA} border-primary bg-primary font-semibold text-white`}
                >
                  {n}
                </span>
              ) : (
                <Link
                  href={hrefCon(estado, { pagina: n })}
                  aria-label={`Página ${n}`}
                  className={`${CELDA} border-border hover:border-primary hover:text-primary`}
                >
                  {n}
                </Link>
              )}
            </li>
          )
        )}
        <li>{flecha(pagina + 1, "Página siguiente", "›")}</li>
      </ul>
    </nav>
  );
}
