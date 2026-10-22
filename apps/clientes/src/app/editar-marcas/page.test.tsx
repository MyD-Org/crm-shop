import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@myd-org/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { esAdminMock, leerMock, notFoundMock } = vi.hoisted(() => ({
  esAdminMock: vi.fn(),
  leerMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth", () => ({ esAdmin: esAdminMock }));
vi.mock("@/lib/marcas/marcas-acciones", () => ({
  leerPaginasMarcaParaEditor: leerMock,
  valoresMarcaParaEditor: vi.fn(async () => ({ ok: true, valores: [] })),
}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import EditarMarcasPage, { metadata } from "./page";

/** Ejecuta el hijo asíncrono del Suspense (el que lee la sesión). */
async function contenido() {
  const raiz = EditarMarcasPage() as unknown as { props: { children: unknown[] } };
  const suspense = (raiz.props.children as { type: unknown; props: { children: { type: () => Promise<unknown> } } }[]).at(-1)!;
  return suspense.props.children.type();
}

describe("/editar-marcas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fuera del índice de buscadores", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("no admin => 404 y ni lee las páginas", async () => {
    esAdminMock.mockResolvedValue(false);
    await expect(contenido()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(leerMock).not.toHaveBeenCalled();
  });

  it("admin: lista las páginas con nivel, estado y enlace", async () => {
    esAdminMock.mockResolvedValue(true);
    leerMock.mockResolvedValue({
      ok: true,
      paginas: [
        {
          slug: "acme",
          nombre: "Acme",
          nivel: "oficial",
          publicada: true,
          orden: 1,
          marcasCatalogo: ["ACME"],
          bajada: "",
          bloques: {},
          visibilidad: {},
        },
      ],
    });
    const html = renderToStaticMarkup(createElement(ToastProvider, null, (await contenido()) as never));
    expect(html).toContain("Acme");
    expect(html).toContain("Tienda oficial");
    expect(html).toContain("Publicada");
    expect(html).toContain('href="/marcas/acme"');
    expect(html).toContain("Nueva página");
  });
});
