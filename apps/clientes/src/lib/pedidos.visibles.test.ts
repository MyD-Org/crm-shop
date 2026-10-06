import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `crearPedido` con `soloVisibles` (flag `catalogo-solo-visibles`): dentro de la transacción rechaza
 * los productos despublicados en el overlay, con un mensaje en usted, y no escribe nada.
 */
let visibles: { alegraId: string }[] = [];
const inserts: unknown[] = [];

const tx = {
  transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  select: () => ({
    from: () => ({
      innerJoin: () => ({ where: async () => visibles }),
      leftJoin: () => ({ where: async () => [{ alegraId: "1", disponible: null }] }),
      where: () => ({ limit: async () => [] }),
    }),
  }),
  execute: async () => {},
  insert: () => ({
    values: (v: unknown) => {
      inserts.push(v);
      return {
        onConflictDoNothing: () => ({ returning: async () => [{ id: "ped-1", numero: 1000, cuotas: null }] }),
        then: (ok: (v: unknown) => void) => ok(undefined),
      };
    },
  }),
};
vi.mock("@/db", () => ({ getDb: () => ({ transaction: (cb: (t: unknown) => unknown) => cb(tx) }) }));
vi.mock("./carrito-db", () => ({ vaciarCarritoTx: async () => {} }));
vi.mock("./catalog", () => ({ getProductosPorIds: async () => [] }));
vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));

import { crearPedido } from "./pedidos";
import type { Cotizacion } from "./cotizacion";

const cotizacion: Cotizacion = {
  lineas: [
    {
      id: "1",
      code: "COD-1",
      name: "Producto",
      brand: "",
      qty: 1,
      precioUnitario: 100,
      ivaPorcentaje: 21,
      subtotal: 100,
      iva: 21,
      total: 121,
      stockDisponible: null,
    },
  ],
  subtotal: 100,
  iva: 21,
  costoEnvio: 0,
  total: 121,
  hayProblemas: false,
  listaPreferencial: false,
};

const datos = (soloVisibles: boolean) => ({
  contactoNombre: "Cliente Ejemplo",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro" as const,
  pagoMetodo: "transferencia",
  soloVisibles,
});

const cliente = { nombre: "Cliente Ejemplo", email: "cliente@cliente.example" } as never;

beforeEach(() => {
  visibles = [];
  inserts.length = 0;
});

describe("crearPedido con producto despublicado", () => {
  it("lo rechaza con un mensaje en usted y no escribe las líneas", async () => {
    await expect(crearPedido(cliente, datos(true), cotizacion)).rejects.toMatchObject({
      name: "ProductoNoDisponibleError",
      ids: ["1"],
      message: "Uno de los productos de su carrito ya no está disponible. Revise su carrito.",
    });
    // La transacción se deshace entera; lo importante es que no se llegó a escribir las líneas.
    expect(inserts.some((v) => Array.isArray(v))).toBe(false);
  });

  it("si está visible, el pedido sigue", async () => {
    visibles = [{ alegraId: "1" }];
    const r = await crearPedido(cliente, datos(true), cotizacion);
    expect(r.id).toBe("ped-1");
  });

  it("sin el flag no consulta la visibilidad", async () => {
    const r = await crearPedido(cliente, datos(false), cotizacion);
    expect(r.id).toBe("ped-1");
  });
});
