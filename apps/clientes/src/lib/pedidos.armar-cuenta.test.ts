import { describe, expect, it } from "vitest";
import { armarOrder, type FilaOrder } from "./pedidos";
import type { CuentaPagoSnapshot } from "./cuentas-bancarias";

const snap: CuentaPagoSnapshot = {
  v: 1,
  cuentaId: "c1",
  alias: "tienda.ejemplo",
  cbu: "0000000000000000000000",
  banco: "Banco Ejemplo",
  titular: "Titular Ejemplo SA",
  cuit: "30000000000",
  motivo: "regla",
  sucursal: "mdp",
  totalEvaluado: 1210,
  congeladaEn: "2026-10-01T12:00:00.000Z",
};

const fila = (pagoCuenta: CuentaPagoSnapshot | null) =>
  ({
    id: "p-1",
    numero: 1042,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    estado: "pendiente",
    pagoEstado: "pendiente",
    pagoMetodo: "transferencia",
    entregaTipo: "retiro",
    entregaCiudad: null,
    entregaDireccion: null,
    subtotal: "1000.00",
    iva: "210.00",
    costoEnvio: "0.00",
    total: "1210.00",
    pagoCuenta,
  }) as unknown as FilaOrder;

describe("armarOrder: cuenta congelada", () => {
  it("expone el snapshot del pedido tal cual, sin releer la cuenta", () => {
    expect(armarOrder(fila(snap), []).cuentaPago).toEqual(snap);
  });

  it("sin snapshot (NULL) no hay cuentaPago: las vistas muestran el mensaje neutro", () => {
    expect(armarOrder(fila(null), [])).not.toHaveProperty("cuentaPago");
  });
});

describe("armarOrder: variantes", () => {
  it("el nombre visible de una variante es Modelo / Opción y lleva su foto; el guardado no se toca", () => {
    const item = { alegraItemId: "12", name: "Panel 18W / Rojo", brand: "", code: "P18", qty: "1", precioUnitario: "100", total: "100" };
    const producto = { id: "12", name: "Panel 18W", opcion: "Rojo", images: [{ url: "https://m.example/rojo.jpg" }] };
    const o = armarOrder(
      fila(null),
      [item] as unknown as Parameters<typeof armarOrder>[1],
      new Map([["12", producto]]) as unknown as Parameters<typeof armarOrder>[2],
    );
    expect(o.items[0].nombreVisible).toBe("Panel 18W / Rojo");
    expect(o.items[0].name).toBe("Panel 18W / Rojo");
    expect(o.items[0].imagen).toEqual({ url: "https://m.example/rojo.jpg" });
  });
});

describe("armarOrder: cupón", () => {
  const foto = {
    codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot", pct: 10, envioGratis: false, provinciasEnvio: null,
    medios: null, formas: null, permiteCuotas: false, condiciones: "", descuento: 121,
  };
  const conCupon = { ...(fila(null) as object), subtotal: "1400.00", iva: "294.00", total: "1694.00", cupon: foto } as unknown as FilaOrder;
  const items = [
    { alegraItemId: "N1", name: "Normal", brand: "", code: "N1", qty: "1", precioUnitario: "900.00", precioSinCupon: "1000.00", ivaPorcentaje: "21", subtotal: "900.00", iva: "189.00", total: "1089.00" },
    { alegraItemId: "C1", name: "Campaña", brand: "", code: "C1", qty: "1", precioUnitario: "500.00", precioSinCupon: null, ivaPorcentaje: "21", subtotal: "500.00", iva: "105.00", total: "605.00" },
  ] as unknown as Parameters<typeof armarOrder>[1];

  it("la línea del cupón y los montos de antes del cupón; las líneas con su precio sin cupón", () => {
    const o = armarOrder(conCupon, items);
    expect(o.cupon).toEqual({ texto: "Cupón LUZ-7KQ2M (10 %)", descuento: 121, envioGratis: false, subtotalAntes: 1500, ivaAntes: 315 });
    expect(o.items.map((i) => [i.price, i.total])).toEqual([[1000, 1210], [500, 605]]);
    expect(o.total).toBe(1694);
  });

  it("sin cupón: cupon null y las líneas como siempre", () => {
    const o = armarOrder(fila(null), items.slice(1));
    expect(o.cupon).toBeNull();
  });
});
