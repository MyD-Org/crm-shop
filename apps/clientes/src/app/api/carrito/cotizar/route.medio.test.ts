import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedioPago } from "@/lib/medios-pago";

/**
 * La lista de precios del medio se resuelve en el servidor desde el slug (`pagoMetodo`); el body
 * nunca decide la lista ni el precio. Con lista privada del comprador se ignora el medio.
 */
let medios: MedioPago[];
const leerMedios = vi.fn(async () => medios);
const cotizar = vi.fn();

let cliente: { codigocliente: string } | null = null;
let listaPrivada: string | null = null;
vi.mock("@/lib/auth", () => ({ identidadActual: async () => ({ clerkUserId: null, cliente }) }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => listaPrivada }));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => (await import("@/lib/envio")).CONFIG_ENVIO_DEFAULT,
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: () => leerMedios() }));

import { POST } from "./route";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "transferencia",
  nombre: "Transferencia",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 1,
  idListaPrecios: "9",
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

let n = 0;
const pedir = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${(n = (n % 200) + 1)}` },
      body: JSON.stringify({ items: [{ id: "1", qty: 1 }], ...extra }),
    }),
  );

const opciones = (i = 0) => cotizar.mock.calls[i][1] as { idListaMedio?: string; idPriceList?: string; idListaPrivada?: string | null };

beforeEach(() => {
  cliente = null;
  listaPrivada = null;
  medios = [medio({})];
  leerMedios.mockClear();
  cotizar.mockReset();
  cotizar.mockResolvedValue({ lineas: [], subtotal: 0, iva: 0, costoEnvio: 0, total: 0, hayProblemas: false });
});

describe("POST /api/carrito/cotizar con pagoMetodo", () => {
  it("usa la lista del medio elegido", async () => {
    expect((await pedir({ pagoMetodo: "transferencia" })).status).toBe(200);
    expect(opciones().idListaMedio).toBe("9");
  });

  it("lee los medios sin caché en cada cotización", async () => {
    await pedir({ pagoMetodo: "transferencia" });
    expect(leerMedios).toHaveBeenCalledTimes(1);
  });

  it("ignora idPriceList, price e idListaMedio que vengan en el body", async () => {
    await pedir({ pagoMetodo: "transferencia", idPriceList: "99", idListaMedio: "98", price: 1 });
    expect(opciones().idListaMedio).toBe("9");
    expect(opciones().idPriceList).toBeUndefined();
    await pedir({ idListaMedio: "98" });
    expect(opciones(1).idListaMedio).toBeUndefined();
  });

  it("slug desconocido o inactivo: lista por defecto, sin 500", async () => {
    expect((await pedir({ pagoMetodo: "no_existe" })).status).toBe(200);
    expect(opciones().idListaMedio).toBeUndefined();
    medios = [medio({ activo: false })];
    expect((await pedir({ pagoMetodo: "transferencia" })).status).toBe(200);
    expect(opciones(1).idListaMedio).toBeUndefined();
  });

  it("medio sin lista: lista por defecto", async () => {
    medios = [medio({ idListaPrecios: null })];
    await pedir({ pagoMetodo: "transferencia" });
    expect(opciones().idListaMedio).toBeUndefined();
  });

  it("usa la modalidad de entrega para decidir si el medio aplica", async () => {
    medios = [medio({ aplicaEnvio: false })];
    await pedir({ pagoMetodo: "transferencia", entregaTipo: "envio" });
    expect(opciones().idListaMedio).toBeUndefined();
  });

  it("con lista privada se ignora la lista del medio y no se leen los medios", async () => {
    cliente = { codigocliente: "42" };
    listaPrivada = "lista-privada-a";
    await pedir({ pagoMetodo: "transferencia" });
    expect(opciones().idListaMedio).toBeUndefined();
    expect(opciones().idListaPrivada).toBe("lista-privada-a");
    expect(leerMedios).not.toHaveBeenCalled();
  });

  it("un cliente sin lista privada conserva el precio por medio", async () => {
    cliente = { codigocliente: "42" };
    await pedir({ pagoMetodo: "transferencia" });
    expect(opciones().idListaMedio).toBe("9");
    expect(opciones().idListaPrivada).toBeNull();
  });

  it("sin pagoMetodo no lee medios (el carrito sin medio cotiza con la lista por defecto)", async () => {
    await pedir();
    expect(leerMedios).not.toHaveBeenCalled();
    expect(opciones().idListaMedio).toBeUndefined();
  });
});
