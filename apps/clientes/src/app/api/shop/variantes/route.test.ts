import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";

/**
 * GET /api/shop/variantes: las opciones de un modelo para el panel «Agregar» de la card. La lectura
 * es la de la ficha (`productoPublico` con `agrupar`); acá se fija el contrato: id validado, flag,
 * rate limit, errores en usted y respuesta liviana.
 */
let variantes = true;
let permitido = true;
const productoPublico = vi.fn();

vi.mock("@/lib/flags-publicos", () => ({
  flagsPublicos: async () => ({ soloVisibles: true, variantes, mediosPrecio: { ficha: [], cuotas: null, modal: [] } }),
}));
vi.mock("@/lib/zona-servidor", () => ({ dispCatalogo: async () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => permitido }));
vi.mock("@/lib/catalogo-publico", () => ({ productoPublico: (...a: unknown[]) => productoPublico(...a) }));

import { GET } from "./route";

const opcion = (id: string, etiqueta: string, over: Partial<Product> = {}): Product => ({
  id,
  name: "Optic 3",
  brand: "Marca",
  price: 100,
  stock: "in",
  opcion: etiqueta,
  description: "texto largo de la ficha",
  especificaciones: [{ label: "Potencia", value: "18 W" }] as unknown as Product["especificaciones"],
  fichaTecnicaUrl: "https://medios.cliente.example/ficha.pdf",
  images: [
    { url: "https://medios.cliente.example/a.webp" },
    { url: "https://medios.cliente.example/b.webp" },
  ] as Product["images"],
  ...over,
});

const pedir = (query = "id=11") => GET(new Request(`https://tienda.example/api/shop/variantes?${query}`));

beforeEach(() => {
  variantes = true;
  permitido = true;
  productoPublico.mockReset().mockResolvedValue({
    ...opcion("11", "Blanco frío"),
    grupo: {
      representanteId: "11",
      opciones: [
        { id: "11", etiqueta: "Blanco frío", producto: opcion("11", "Blanco frío") },
        { id: "12", etiqueta: "Blanco cálido", producto: opcion("12", "Blanco cálido", { stock: "out" }) },
      ],
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/shop/variantes", () => {
  it("devuelve el modelo y sus opciones, livianas (sin ficha ni características, una sola foto)", async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.nombre).toBe("Optic 3");
    expect(body.representanteId).toBe("11");
    expect(body.opciones.map((o: Product) => [o.id, o.opcion, o.stock])).toEqual([
      ["11", "Blanco frío", "in"],
      ["12", "Blanco cálido", "out"],
    ]);
    for (const o of body.opciones) {
      expect(o.description).toBeUndefined();
      expect(o.especificaciones).toBeUndefined();
      expect(o.fichaTecnicaUrl).toBeUndefined();
      expect(o.images).toHaveLength(1);
    }
  });

  it("lee con agrupar (overlay del ancla) y con soloVisibles", async () => {
    await pedir();
    const a = productoPublico.mock.calls[0];
    expect(a[0]).toBe("11");
    expect(a[1]).toBe(true);
    expect(a[7]).toBe(true);
  });

  it("un id que no es de producto: 400 en usted, sin consultar", async () => {
    const r = await pedir("id=1%27%3Bdrop");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Producto no válido.");
    expect(productoPublico).not.toHaveBeenCalled();
  });

  it("sin id: 400", async () => {
    expect((await pedir("")).status).toBe(400);
  });

  it("flag apagado: 404 y no consulta", async () => {
    variantes = false;
    const r = await pedir();
    expect(r.status).toBe(404);
    expect(productoPublico).not.toHaveBeenCalled();
  });

  it("producto inexistente, oculto o sin opciones: 404 con mensaje en usted", async () => {
    productoPublico.mockResolvedValue(null);
    expect((await pedir()).status).toBe(404);
    productoPublico.mockResolvedValue(opcion("11", "Único"));
    const r = await pedir();
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("Este producto no tiene opciones.");
  });

  it("demasiadas consultas: 429", async () => {
    permitido = false;
    const r = await pedir();
    expect(r.status).toBe(429);
    expect(productoPublico).not.toHaveBeenCalled();
  });

  it("si la base falla: 503 con mensaje en usted, sin filtrar el error", async () => {
    productoPublico.mockRejectedValue(new Error("connection refused 10.0.0.1"));
    const r = await pedir();
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("10.0.0.1");
  });

  it("el precio es público: sólo caché privada y corta", async () => {
    expect((await pedir()).headers.get("Cache-Control")).toBe("private, max-age=30");
  });
});
