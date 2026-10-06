/**
 * La tubería `motor` informa las medidas del plan como `v2`: los ids que `aplicarMedidas` produjo en
 * `ResultadoBanco.medidas` y, en el catálogo, los que quedaron como filtro duro en `atributosDuros`. Antes
 * no las informaba y el análisis las mostraba como «sin-plan» (la tubería no produce medidas).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";

const prod = (id: string) => ({ id, name: id }) as unknown as Product;
const entender = vi.fn();

vi.mock("@/lib/catalog", () => ({
  PRODUCTOS_POR_PAGINA: 24,
  contarCatalogo: async () => 10,
  getPaginaCatalogo: async (o: { sinConteo?: boolean }) => ({ productos: [prod("a"), prod("b")], total: 2, pagina: 1, paginas: 1, totalExacto: !o.sinConteo }),
}));
vi.mock("../entender/entender", () => ({ entender: (...a: unknown[]) => entender(...a) }));
// Cobertura total y 50 productos en cualquier universo: la 2x20 de una térmica pasa a filtro duro.
vi.mock("../conteo", () => ({ contador: () => async () => 50 }));

import { planVacio, type PlanBusqueda } from "../plan";
import { ejecutarMotor } from "./motor";

const plan = (q: string): PlanBusqueda => ({
  ...planVacio(q),
  blandos: { categorias: [], atributos: [], terminos: [{ texto: "termica", peso: 1 }] },
});

beforeEach(() => {
  entender.mockReset();
  entender.mockImplementation(async (q: string) => ({ plan: plan(q), msJev: null, jevFallo: false, consultaNorm: q }));
});

const ctx = { arbol: [], jev: null, estructurados: true };

describe("ejecutarMotor con medidas", () => {
  it("catálogo: informa los ids del plan y cuáles quedaron duros", async () => {
    const r = await ejecutarMotor("termica 2x20", { ...ctx, superficie: "catalogo", medidas: true });
    expect(r.medidas).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
    expect(r.atributosDuros).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
  });

  for (const superficie of ["autocompletar", "chat"] as const) {
    it(`${superficie}: informa los ids del plan (sin duros: así sale en producción)`, async () => {
      const r = await ejecutarMotor("termica 2x20", { ...ctx, superficie, medidas: true });
      expect(r.medidas).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
      expect(r.atributosDuros).toEqual([]);
    });
  }

  it("sin --medidas: la tubería no las produce (ausente, no vacío)", async () => {
    for (const superficie of ["catalogo", "autocompletar", "chat"] as const) {
      const r = await ejecutarMotor("termica 2x20", { ...ctx, superficie });
      expect(r.medidas).toBeUndefined();
    }
  });

  it("consulta sin medidas: lista vacía (la tubería las produce y no encontró ninguna)", async () => {
    const r = await ejecutarMotor("termica", { ...ctx, superficie: "catalogo", medidas: true });
    expect(r.medidas).toEqual([]);
  });
});
