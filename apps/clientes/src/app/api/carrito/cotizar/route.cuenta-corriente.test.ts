import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { MedioPago } from "@/lib/medios-pago";

/**
 * Cotización de un comprador con cuenta corriente (change `listas-cuenta-corriente`, rebanada D):
 * sin cuotas, sin lista de precios por medio y sin cuenta de transferencia, mande lo que mande el
 * body. Fixtures sintéticas.
 */
let medios: MedioPago[];
let tipoCuenta: "corriente" | "contado" | undefined;
const cotizar = vi.fn();

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({
    clerkUserId: "user_1",
    cliente: tipoCuenta ? { codigocliente: "C-1", tipoCuenta, origen: "vinculacion" } : null,
  }),
  idPriceListCliente: async () => undefined,
}));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => (await import("@/lib/envio")).CONFIG_ENVIO_DEFAULT,
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));

import { POST } from "./route";

const medio = (o: Partial<MedioPago> & { slug: string }): MedioPago => ({
  nombre: o.slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 1,
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

let n = 0;
const pedir = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${(n = (n % 200) + 1)}` },
      body: JSON.stringify({ items: [{ id: "1", qty: 1 }], ...extra }),
    }),
  );

const opcionesDe = (i = 0) => cotizar.mock.calls[i][1] as { idListaMedio?: string };

beforeEach(() => {
  tipoCuenta = "corriente";
  medios = [
    medio({
      slug: "mercadopago",
      cobroOnline: true,
      idListaPrecios: "L1",
      condicionesCuotas: [{ cuotas: 3, idListaPrecios: "L3" }],
    }),
    medio({ slug: "efectivo-cheque", audiencia: "cuenta_corriente", idListaPrecios: "LCC" }),
  ];
  cotizar.mockReset();
  cotizar.mockResolvedValue({ lineas: [], subtotal: 0, iva: 0, costoEnvio: 0, total: 1210, hayProblemas: false });
  setFlag("cuotas-cobro", true);
});

describe("POST /api/carrito/cotizar — cuenta corriente", () => {
  it("no devuelve opciones de cuotas ni escalón aunque pida Mercado Pago con cuotas", async () => {
    const r = await pedir({ pagoMetodo: "mercadopago", cuotas: 3, conCuotas: true });
    const json = await r.json();
    expect(json).not.toHaveProperty("cuotasOpciones");
    expect(json).not.toHaveProperty("proximoEscalon");
    expect(opcionesDe().idListaMedio).toBeUndefined();
  });

  it("no aplica la lista de ningún medio (el precio lo decide la lista de la cuenta, no el medio)", async () => {
    await pedir({ pagoMetodo: "efectivo-cheque" });
    expect(opcionesDe().idListaMedio).toBeUndefined();
  });

  it("no devuelve la cuenta de transferencia", async () => {
    const r = await pedir({ pagoMetodo: "efectivo-cheque", conCuenta: true });
    expect(await r.json()).not.toHaveProperty("cuentaTransferencia");
  });
});

describe("POST /api/carrito/cotizar — sin cuenta corriente", () => {
  it("contado: cuotas y lista del medio siguen como siempre", async () => {
    tipoCuenta = "contado";
    await pedir({ pagoMetodo: "mercadopago", cuotas: 3 });
    expect(opcionesDe().idListaMedio).toBe("L3");
  });

  it("contado: el medio de cuenta corriente no aporta lista", async () => {
    tipoCuenta = "contado";
    await pedir({ pagoMetodo: "efectivo-cheque" });
    expect(opcionesDe().idListaMedio).toBeUndefined();
  });
});
