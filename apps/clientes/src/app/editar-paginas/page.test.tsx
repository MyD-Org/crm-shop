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
vi.mock("@/lib/paginas-acciones", () => ({ leerPaginasParaEditor: leerMock }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import EditarPaginasPage, { metadata } from "./page";

/** Ejecuta el hijo asíncrono del Suspense (el que lee la sesión). */
async function contenido() {
  const raiz = EditarPaginasPage() as unknown as { props: { children: unknown[] } };
  const suspense = (raiz.props.children as { type: unknown; props: { children: { type: () => Promise<unknown> } } }[]).at(-1)!;
  return suspense.props.children.type();
}

describe("/editar-paginas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fuera del índice de buscadores", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("no admin => 404 y ni lee las páginas", async () => {
    esAdminMock.mockResolvedValue(false);
    await expect(contenido()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(leerMock).not.toHaveBeenCalled();
  });

  it("admin: lista las 5 páginas con estado y botón Editar", async () => {
    esAdminMock.mockResolvedValue(true);
    leerMock.mockResolvedValue({
      ok: true,
      paginas: ["Garantía", "Nosotros"].map((titulo, i) => ({
        slug: i ? "nosotros" : "garantia",
        titulo,
        publicada: i === 0,
        personalizada: false,
        bloques: [{ titulo: "A", parrafos: ["b"] }],
      })),
    });
    const html = renderToStaticMarkup(createElement(ToastProvider, null, (await contenido()) as never));
    expect(html).toContain("Garantía");
    expect(html).toContain("Publicada");
    expect(html).toContain("Oculta");
    expect(html).toContain("Editar");
  });
});
