"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Checkbox, Chip, ProductCard, Select } from "@myd-org/ui";
import { Footer } from "@/components/Footer";
import { AddToCartButton } from "@/components/AddToCartButton";
import type { Product } from "@/data/products";
import type { Facetas } from "@/lib/catalog";

const SORT_OPTIONS = [
  { label: "Más vendidos", value: "ventas" },
  { label: "Precio: menor a mayor", value: "precio-asc" },
  { label: "Precio: mayor a menor", value: "precio-desc" },
  { label: "Nombre A-Z", value: "nombre" },
];

/**
 * UI interactiva del catálogo (filtros, orden). Los productos y las facetas
 * llegan ya resueltos desde Alegra vía el Server Component `catalogo/page.tsx`.
 */
export function CatalogoClient({
  productos,
  facetas,
  query,
}: {
  productos: Product[];
  facetas: Facetas;
  query?: string;
}) {
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [sort, setSort] = useState("ventas");

  const removeFilter = (f: string) =>
    setActiveFilters((prev) => prev.filter((x) => x !== f));

  const toggleFilter = (f: string) =>
    setActiveFilters((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );

  const sortedProducts = useMemo(() => {
    // Categorias y marcas se combinan con AND entre grupos y OR dentro de cada
    // grupo: "Categoria A o B" Y "Marca X o Y".
    const catsSel = activeFilters.filter((f) =>
      facetas.categorias.some((c) => c.label === f),
    );
    const marcasSel = activeFilters.filter((f) =>
      facetas.marcas.some((m) => m.label === f),
    );

    const list = productos.filter(
      (p) =>
        (catsSel.length === 0 || (p.category && catsSel.includes(p.category))) &&
        (marcasSel.length === 0 || (p.brand && marcasSel.includes(p.brand))),
    );
    switch (sort) {
      case "precio-asc":
        return list.sort((a, b) => a.price - b.price);
      case "precio-desc":
        return list.sort((a, b) => b.price - a.price);
      case "nombre":
        return list.sort((a, b) => a.name.localeCompare(b.name, "es"));
      default:
        return list;
    }
  }, [sort, productos, activeFilters, facetas]);

  return (
    <>
      <main className="mx-auto flex max-w-7xl flex-1 gap-6 px-4 py-8">
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
                        checked={activeFilters.includes(c.label)}
                        onCheckedChange={() => toggleFilter(c.label)}
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
                        checked={activeFilters.includes(b.label)}
                        onCheckedChange={() => toggleFilter(b.label)}
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
                {query ? `Resultados para "${query}"` : "Catálogo"}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {sortedProducts.length} productos
              </p>
            </div>
            <Select
              options={SORT_OPTIONS}
              value={sort}
              onValueChange={setSort}
              aria-label="Ordenar productos"
              className="w-52"
            />
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {activeFilters.map((f) => (
                  <Chip key={f} variant="removable" onRemove={() => removeFilter(f)}>
                    {f}
                  </Chip>
                ))}
                <button
                  onClick={() => setActiveFilters([])}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Limpiar todo
                </button>
              </div>
            )}
          </div>

          {sortedProducts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">
              No se encontraron productos.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sortedProducts.map((p) => (
                <Link key={p.id} href={`/producto/${p.id}`}>
                  <ProductCard
                    name={p.name}
                    brand={p.brand}
                    price={p.price}
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
                  />
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </>
  );
}
