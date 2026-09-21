import { describe, expect, it, vi } from "vitest";
import { sincronizarCatalogo, type Cursor, type RepoCatalogo } from "./catalogo-sync-overlay";
import type { ContratoOverlay } from "./catalogo-contrato";

const AHORA = new Date("2026-09-20T12:00:00Z");

function taxonomia(extra: Record<string, unknown> = {}) {
  return {
    version: "v1",
    tenant: "t",
    actualizadoEn: "2026-09-20T12:00:00.000Z",
    categorias: [
      { id: "11111111-1111-4111-8111-111111111111", parentId: null, nombre: "Iluminación", slug: "iluminacion", orden: 0, nivel: 1, activa: true, imagen: null },
    ],
    tags: [{ id: "22222222-2222-4222-8222-222222222222", nombre: "Oferta", slug: "oferta" }],
    ...extra,
  };
}

function overlay(items: unknown[], nextCursor: Cursor | null, hasMore: boolean) {
  return { version: "v1", tenant: "t", items, nextCursor, hasMore };
}

const item = (alegraId: string, updatedAt = "2026-09-20T12:00:00.000001Z") => ({
  alegraId,
  visible: true,
  nombre: null,
  descripcion: null,
  categoriaId: null,
  orden: null,
  tagIds: [],
  fotos: [],
  updatedAt,
});

function repoFalso() {
  const estado = {
    taxonomias: [] as unknown[],
    paginas: [] as { items: ContratoOverlay["items"]; cursor: Cursor | null }[],
    errores: [] as string[],
    cursor: null as Cursor | null,
  };
  const repo: RepoCatalogo = {
    reemplazarTaxonomia: vi.fn(async (t) => {
      estado.taxonomias.push(t);
    }),
    aplicarPaginaOverlay: vi.fn(async (items, cursor) => {
      estado.paginas.push({ items, cursor });
      estado.cursor = cursor;
    }),
    leerCursor: vi.fn(async () => estado.cursor),
    registrarError: vi.fn(async (e) => {
      estado.errores.push(e);
    }),
    registrarIntento: vi.fn(async () => {}),
  };
  return { repo, estado };
}

describe("sincronizarCatalogo", () => {
  it("copia la taxonomía y recorre el delta hasta agotarlo", async () => {
    const { repo, estado } = repoFalso();
    const paginas = [
      overlay([item("1"), item("2")], { desde: "2026-09-20T12:00:00.000002Z", cursor: "2" }, true),
      overlay([item("3")], null, false),
    ];
    let i = 0;

    const r = await sincronizarCatalogo(
      { repo, obtenerTaxonomia: async () => taxonomia(), obtenerOverlay: async () => paginas[i++], ahora: () => AHORA },
      "cron",
    );

    expect(r).toMatchObject({ ok: true, categorias: 1, tags: 1, items: 3, paginas: 2 });
    expect(estado.paginas).toHaveLength(2);
  });

  it("si la taxonomía falla, NO toca el overlay: la copia anterior queda intacta", async () => {
    const { repo, estado } = repoFalso();

    const r = await sincronizarCatalogo(
      {
        repo,
        obtenerTaxonomia: async () => {
          throw new Error("500");
        },
        obtenerOverlay: async () => overlay([item("1")], null, false),
        ahora: () => AHORA,
      },
      "cron",
    );

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/taxonomía/)
    // Lo importante: no se aplicó ni una página. Un overlay contra un árbol viejo es peor que nada.
    expect(estado.paginas).toHaveLength(0);
    expect(repo.aplicarPaginaOverlay).not.toHaveBeenCalled();
  });

  it("una respuesta inválida del CRM no se guarda", async () => {
    const { repo, estado } = repoFalso();

    const r = await sincronizarCatalogo(
      { repo, obtenerTaxonomia: async () => ({ version: "v2", tenant: "t" }), obtenerOverlay: async () => overlay([], null, false), ahora: () => AHORA },
      "cron",
    );

    // Una versión distinta no se intenta interpretar: es el desfasaje que dejó cuotas roto.
    expect(r.ok).toBe(false);
    expect(estado.taxonomias).toHaveLength(0);
    expect(estado.errores[0]).toMatch(/v1.*v2|v2/);
  });

  it("las páginas ya aplicadas QUEDAN si una posterior falla", async () => {
    const { repo, estado } = repoFalso();
    let i = 0;

    const r = await sincronizarCatalogo(
      {
        repo,
        obtenerTaxonomia: async () => taxonomia(),
        obtenerOverlay: async () => {
          if (i++ === 0) return overlay([item("1")], { desde: "x", cursor: "1" }, true);
          throw new Error("timeout");
        },
        ahora: () => AHORA,
      },
      "cron",
    );

    expect(r.ok).toBe(false);
    expect(r.items).toBe(1);
    // El delta es incremental: la próxima corrida sigue desde el cursor guardado.
    expect(estado.paginas).toHaveLength(1);
    expect(estado.cursor).toEqual({ desde: "x", cursor: "1" });
  });

  it("corta si el cursor no avanza, en vez de girar para siempre contra el CRM", async () => {
    const { repo } = repoFalso();
    const mismo = { desde: "x", cursor: "1" };

    const r = await sincronizarCatalogo(
      {
        repo,
        obtenerTaxonomia: async () => taxonomia(),
        obtenerOverlay: async () => overlay([item("1")], mismo, true),
        ahora: () => AHORA,
      },
      "cron",
    );

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no avanza/);
  });

  it("al terminar guarda el cursor del ÚLTIMO item, no null", async () => {
    // El contrato manda nextCursor:null en la última página. Guardar ese null borraba el punto de
    // reanudación y la corrida siguiente se traía el catálogo entero otra vez.
    const { repo, estado } = repoFalso();

    await sincronizarCatalogo(
      {
        repo,
        obtenerTaxonomia: async () => taxonomia(),
        obtenerOverlay: async () => overlay([item("7", "2026-09-20T12:00:00.000009Z")], null, false),
        ahora: () => AHORA,
      },
      "cron",
    );

    expect(estado.cursor).toEqual({ desde: "2026-09-20T12:00:00.000009Z", cursor: "7" });
  });

  it("una página vacía al final conserva el cursor anterior", async () => {
    const { repo, estado } = repoFalso();
    estado.cursor = { desde: "2026-09-20T10:00:00.000000Z", cursor: "500" };

    await sincronizarCatalogo(
      {
        repo,
        obtenerTaxonomia: async () => taxonomia(),
        obtenerOverlay: async () => overlay([], null, false),
        ahora: () => AHORA,
      },
      "cron",
    );

    expect(estado.cursor).toEqual({ desde: "2026-09-20T10:00:00.000000Z", cursor: "500" });
  });

  it("reanuda desde el cursor guardado", async () => {
    const { repo, estado } = repoFalso();
    estado.cursor = { desde: "2026-09-20T10:00:00.000000Z", cursor: "500" };
    const vistos: (Cursor | null)[] = [];

    await sincronizarCatalogo(
      {
        repo,
        obtenerTaxonomia: async () => taxonomia(),
        obtenerOverlay: async (c) => {
          vistos.push(c);
          return overlay([], null, false);
        },
        ahora: () => AHORA,
      },
      "cron",
    );

    expect(vistos[0]).toEqual({ desde: "2026-09-20T10:00:00.000000Z", cursor: "500" });
  });

  it("una taxonomía vacía es válida y se guarda: el CRM puede no tener categorías todavía", async () => {
    const { repo, estado } = repoFalso();

    const r = await sincronizarCatalogo(
      {
        repo,
        obtenerTaxonomia: async () => taxonomia({ categorias: [], tags: [] }),
        obtenerOverlay: async () => overlay([], null, false),
        ahora: () => AHORA,
      },
      "cron",
    );

    expect(r.ok).toBe(true);
    expect(estado.taxonomias).toHaveLength(1);
  });
});
