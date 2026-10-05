import { describe, expect, it } from "vitest";
import { esPublicado, resumirUniverso, snapshotCatalogo, type FilaUniverso } from "./universo";

const fila = (id: string, p: Partial<FilaUniverso> = {}): FilaUniverso => ({
  alegraId: id,
  activo: true,
  tieneOverlay: true,
  visible: true,
  categoriaId: "cat-1",
  conStock: false,
  conPrecio: true,
  ...p,
});

/**
 * Fixture del spec: 10 activos, 7 con overlay visible (publicados), 5 con
 * stock, 4 en la intersección y 3 sin overlay; más un inactivo con stock que
 * no cuenta en nada.
 */
function fixture(): FilaUniverso[] {
  return [
    fila("p1", { conStock: true }),
    fila("p2", { conStock: true }),
    fila("p3", { conStock: true }),
    fila("p4", { conStock: true }),
    fila("p5"),
    fila("p6"),
    fila("p7"),
    fila("n1", { tieneOverlay: false, visible: false, categoriaId: null, conStock: true }),
    fila("n2", { tieneOverlay: false, visible: false, categoriaId: null }),
    fila("n3", { tieneOverlay: false, visible: false, categoriaId: null }),
    fila("inactivo", { activo: false, conStock: true }),
  ];
}

describe("esPublicado", () => {
  it("activo, visible y con precio", () => {
    expect(esPublicado(fila("a"))).toBe(true);
    expect(esPublicado(fila("a", { activo: false }))).toBe(false);
    expect(esPublicado(fila("a", { visible: false }))).toBe(false);
    expect(esPublicado(fila("a", { conPrecio: false }))).toBe(false);
  });
});

describe("resumirUniverso", () => {
  it("10 activos / 7 publicados / 5 con stock / 4 en la intersección / 3 sin overlay", () => {
    expect(resumirUniverso(fixture())).toMatchObject({
      activos: 10,
      publicados: 7,
      conStock: 5,
      publicadosConStock: 4,
      sinOverlay: 3,
    });
  });

  it("un inactivo no cuenta en ningún número", () => {
    const solo = resumirUniverso([fila("inactivo", { activo: false, conStock: true })]);
    expect(solo).toEqual({ activos: 0, publicados: 0, conStock: 0, publicadosConStock: 0, sinOverlay: 0, sinCategoria: 0 });
  });

  it("sin categoría propia: activos con categoriaId nulo (con o sin overlay)", () => {
    const r = resumirUniverso([fila("a", { categoriaId: null }), fila("b", { tieneOverlay: false, categoriaId: null }), fila("c")]);
    expect(r.sinCategoria).toBe(2);
  });

  it("publicado exige precio: un visible sin precio no es publicado", () => {
    const r = resumirUniverso([fila("a", { conPrecio: false, conStock: true })]);
    expect(r.publicados).toBe(0);
    expect(r.publicadosConStock).toBe(0);
    expect(r.conStock).toBe(1);
  });

  it("coherencia: publicadosConStock <= min(publicados, conStock)", () => {
    const r = resumirUniverso(fixture());
    expect(r.publicadosConStock).toBeLessThanOrEqual(Math.min(r.publicados, r.conStock));
  });

  it("sin filas: todo en cero", () => {
    expect(resumirUniverso([])).toEqual({ activos: 0, publicados: 0, conStock: 0, publicadosConStock: 0, sinOverlay: 0, sinCategoria: 0 });
  });
});

describe("snapshotCatalogo", () => {
  const arbol = [
    { id: "c1", parentId: null, nombre: "Raiz", orden: 1 },
    { id: "c2", parentId: "c1", nombre: "Hija", orden: 1 },
  ];

  it("junta el universo, las categorías, el hash del árbol y si hay estructurados", async () => {
    const s = await snapshotCatalogo(arbol, true, async () => fixture());
    expect(s.universo).toMatchObject({ activos: 10, publicados: 7, publicadosConStock: 4 });
    expect(s.categorias).toBe(2);
    expect(s.arbolHash).toMatch(/^[0-9a-f]{32}$/);
    expect(s.estructurados).toBe(true);
  });

  it("el hash cambia si cambia el árbol", async () => {
    const a = await snapshotCatalogo(arbol, true, async () => []);
    const b = await snapshotCatalogo([...arbol, { id: "c3", parentId: null, nombre: "Nueva", orden: 2 }], true, async () => []);
    expect(a.arbolHash).not.toBe(b.arbolHash);
  });

  it("si la lectura del universo falla: no_disponible con motivo, sin romper ni filtrar el error", async () => {
    const s = await snapshotCatalogo(arbol, false, async () => {
      throw new Error('relation "public.catalog_overlay" does not exist; postgres://usuario:clave@host/db');
    });
    expect(s.universo).toEqual({ no_disponible: expect.any(String) });
    expect(JSON.stringify(s)).not.toContain("postgres://");
    expect(JSON.stringify(s)).not.toContain("clave");
    expect(s.categorias).toBe(2);
  });
});
