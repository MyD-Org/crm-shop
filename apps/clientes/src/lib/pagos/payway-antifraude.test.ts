import { describe, expect, it } from "vitest";
import { NEUTROS, armarFraudDetection, limpiarTelefono, partirNombre } from "./payway-antifraude";
import type { DatosAntifraude } from "./tipos";

// Pedido sintético: nada de datos reales.
const base = (extra: Partial<DatosAntifraude> = {}): DatosAntifraude => ({
  clienteId: "user_sintetico123",
  email: "comprador@cliente.example",
  nombre: "María José Pérez",
  telefono: "+54 9 223 555-0100",
  diasEnSitio: 12,
  facturacionDomicilio: "Av. Colón 1234, Piso 2",
  entrega: { tipo: "envio", ciudad: "Mar del Plata", direccion: "Calle Falsa 123" },
  items: [
    { sku: "LED-9W", nombre: "Lámpara LED 9W", cantidad: 3, total: 3630 },
    { sku: "CABLE-2", nombre: "Cable 2m", cantidad: 1, total: 1210.5 },
  ],
  ...extra,
});

describe("armarFraudDetection (Cybersource Retail)", () => {
  it("arma la forma de la documentación con importes en centavos", () => {
    const fd = armarFraudDetection(base(), 4840.5);
    expect(fd).toEqual({
      send_to_cs: true,
      channel: "Web",
      bill_to: {
        city: "Mar del Plata",
        country: "AR",
        customer_id: "user_sintetico123",
        email: "comprador@cliente.example",
        first_name: "Maria",
        last_name: "Jose Perez",
        phone_number: "5492235550100",
        postal_code: NEUTROS.postal_code,
        state: NEUTROS.state,
        street1: "Av. Colon 1234, Piso 2",
      },
      purchase_totals: { currency: "ARS", amount: 484050 },
      customer_in_site: { is_guest: false, days_in_site: 12 },
      retail_transaction_data: {
        ship_to: {
          city: "Mar del Plata",
          country: "AR",
          email: "comprador@cliente.example",
          first_name: "Maria",
          last_name: "Jose Perez",
          phone_number: "5492235550100",
          postal_code: NEUTROS.postal_code,
          state: NEUTROS.state,
          street1: "Calle Falsa 123",
        },
        tax_voucher_required: true,
        items: [
          { code: "default", description: "Lampara LED 9W", name: "Lampara LED 9W", sku: "LED-9W", total_amount: 363000, quantity: 3, unit_price: 121000 },
          { code: "default", description: "Cable 2m", name: "Cable 2m", sku: "CABLE-2", total_amount: 121050, quantity: 1, unit_price: 121050 },
        ],
      },
    });
  });

  it("los items suman el monto del pedido cuando el total de línea es exacto", () => {
    const fd = armarFraudDetection(base(), 4840.5);
    const suma = fd.retail_transaction_data.items.reduce((a, i) => a + i.total_amount, 0);
    expect(suma).toBe(fd.purchase_totals.amount);
  });

  it("retiro en local: el destino replica los datos de facturación, no el domicilio del comercio", () => {
    const fd = armarFraudDetection(base({ entrega: { tipo: "retiro", ciudad: null, direccion: null } }), 4840.5);
    const { customer_id, ...bill } = fd.bill_to;
    expect(customer_id).toBe("user_sintetico123");
    expect(fd.retail_transaction_data.ship_to).toEqual(bill);
    expect(fd.bill_to.street1).toBe("Av. Colon 1234, Piso 2");
  });

  it("sin ningún domicilio ni ciudad usa los valores neutros documentados", () => {
    const fd = armarFraudDetection(
      base({ facturacionDomicilio: null, entrega: { tipo: "retiro", ciudad: null, direccion: null }, telefono: "" }),
      4840.5,
    );
    expect(fd.bill_to.street1).toBe(NEUTROS.street);
    expect(fd.bill_to.city).toBe(NEUTROS.city);
    expect(fd.bill_to.phone_number).toBe(NEUTROS.phone);
  });

  it("cantidad fraccionaria: un renglón por el total (unitario × cantidad cierra)", () => {
    const fd = armarFraudDetection(base({ items: [{ sku: "X", nombre: "Cinta", cantidad: 2.5, total: 100 }] }), 100);
    expect(fd.retail_transaction_data.items[0]).toMatchObject({ quantity: 1, unit_price: 10000, total_amount: 10000 });
  });

  it("sin días de registro no manda days_in_site", () => {
    const fd = armarFraudDetection(base({ diasEnSitio: undefined }), 4840.5);
    expect(fd.customer_in_site).toEqual({ is_guest: false });
  });

  it("el identificador del comprador no puede ser vacío y se corta a 50", () => {
    expect(() => armarFraudDetection(base({ clienteId: " " }), 10)).toThrow(/identificador/);
    expect(armarFraudDetection(base({ clienteId: "x".repeat(80) }), 10).bill_to.customer_id).toHaveLength(50);
  });

  it("falla ruidoso sin correo, sin productos o con un monto inválido", () => {
    expect(() => armarFraudDetection(base({ email: "" }), 10)).toThrow(/correo/);
    expect(() => armarFraudDetection(base({ items: [] }), 10)).toThrow(/productos/);
    expect(() => armarFraudDetection(base(), 0)).toThrow();
  });

  it("la ciudad empieza con letra y los nombres no llevan caracteres especiales", () => {
    const fd = armarFraudDetection(base({ nombre: "Ñandú O'Brien-López", entrega: { tipo: "envio", ciudad: "9 de Julio", direccion: "Ruta 5 km 3" } }), 10);
    expect(fd.bill_to.city).toBe("de Julio");
    expect(fd.bill_to.first_name).toBe("Nandu");
    expect(fd.bill_to.last_name).toBe("O Brien Lopez");
  });
});

describe("helpers", () => {
  it("partirNombre", () => {
    expect(partirNombre("Ana")).toEqual({ nombre: "Ana", apellido: NEUTROS.apellido });
    expect(partirNombre("")).toEqual({ nombre: NEUTROS.nombre, apellido: NEUTROS.apellido });
  });
  it("limpiarTelefono deja sólo dígitos y máximo 15", () => {
    expect(limpiarTelefono("(011) 4000-1234")).toBe("01140001234");
    expect(limpiarTelefono("1".repeat(20))).toHaveLength(15);
    expect(limpiarTelefono("12")).toBe(NEUTROS.phone);
  });
});
