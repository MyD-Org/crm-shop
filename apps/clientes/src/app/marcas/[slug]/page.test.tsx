import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getPaginaMarca: vi.fn() }));
vi.mock("@/lib/marcas/marcas-datos", () => ({ getPaginaMarca: m.getPaginaMarca }));
vi.mock("@/lib/marca", async () => ({
  getMarca: async () => (await import("@/lib/marca-base")).MARCA_POR_DEFECTO,
}));
vi.mock("@/lib/auth", () => ({ esAdmin: vi.fn(async () => false) }));
vi.mock("@/components/marcas/PaginaMarcaVista", () => ({ PaginaMarcaVista: () => null }));
vi.mock("@/components/marcas/bloques/ProductosMarca", () => ({ totalProductosMarca: vi.fn() }));
vi.mock("@/lib/home-datos", () => ({ getDatosFooter: vi.fn() }));

import type { ReactElement } from "react";
import PaginaMarcaPage, { generateMetadata } from "./page";

const pagina = (publicada: boolean) => ({
  slug: "secreta",
  nombre: "Marca secreta",
  nivel: "oficial",
  publicada,
  orden: 1,
  marcasCatalogo: ["X"],
  bajada: "Lanzamiento todavía no anunciado",
  bloques: {},
  visibilidad: {},
});

const props = { params: Promise.resolve({ slug: "secreta" }), searchParams: Promise.resolve({}) };

describe("/marcas/[slug] metadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("una página no publicada no expone título ni descripción", async () => {
    m.getPaginaMarca.mockResolvedValue(pagina(false));
    const meta = await generateMetadata(props);
    expect(JSON.stringify(meta)).not.toContain("Marca secreta");
    expect(JSON.stringify(meta)).not.toContain("Lanzamiento");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("una publicada lleva su título", async () => {
    m.getPaginaMarca.mockResolvedValue(pagina(true));
    expect(JSON.stringify(await generateMetadata(props))).toContain("Marca secreta");
  });
});

describe("/marcas/[slug] shell", () => {
  // Al entrar desde abajo de la home, el router de Next solo sube al tope si el fallback no queda
  // a la vista: uno más bajo que la pantalla hace que el navegador recorte el scroll dentro de él.
  it("el fallback es más alto que la pantalla", () => {
    const shell = PaginaMarcaPage(props) as ReactElement<{ fallback: ReactElement<{ className: string }> }>;
    expect(shell.props.fallback.props.className).toContain("min-h-[120vh]");
  });
});
