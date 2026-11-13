import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { setFlag } from "@/test/flags";
import { metodoDePrueba, puntoDePrueba } from "@/test/envio-metodo";
import { firmarGeo } from "@/lib/geo-token";
import { EnvioCambioError } from "@/lib/envio-snapshot";

/**
 * `POST /api/pedidos` con el envío por zona (change `envio-por-zona-con-tarifa`): el costo sale del
 * servidor con coordenadas verificadas, se congela en `crearPedido`, y la dirección sin ubicar o el
 * origen que cambió responden 409 sin crear nada. Con el flag apagado el pedido es el de siempre.
 */

const crearPedido = vi.fn();
const leerConfigEnvio = vi.fn();
const cotizar = vi.fn();
const direccionParaEnvio = vi.fn();

vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => false }));
vi.mock("@/lib/direcciones-envio-db", () => ({ direccionParaEnvio: (...a: unknown[]) => direccionParaEnvio(...a) }));
const mediosCrm = ["transferencia", "mercadopago"].map((slug, orden) => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: slug === "mercadopago",
  orden,
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => mediosCrm }));
vi.mock("@/lib/sucursales-repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: (...a: unknown[]) => leerConfigEnvio(...a),
}));

import { POST } from "./route";

const SECRETO = "s3cr3t-placeholder-para-tests-pedidos-0123456789";
const CENTRO = puntoDePrueba("centro");
const token = () =>
  firmarGeo({
    lat: CENTRO.lat,
    lon: CENTRO.lon,
    calle: "Calle Ejemplo 123",
    ciudad: "Ciudad Ejemplo",
    provincia: "Buenos Aires",
    cp: "7600",
    precision: "altura",
  });

const conEnvio = {
  entregaTipo: "envio",
  entregaCiudad: "Ciudad Ejemplo",
  entregaDireccion: "Calle Ejemplo 123",
  entregaProvincia: "Buenos Aires",
  pagoMetodo: "transferencia",
};

const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: "1", qty: 1 }],
        contactoNombre: "Ana",
        contactoTelefono: "123",
        ...conEnvio,
        ...extra,
      }),
    }),
  );

const datosGuardados = () => crearPedido.mock.calls[0][1];

beforeEach(() => {
  vi.stubEnv("GEOCODE_FIRMA_SECRET", SECRETO);
  crearPedido.mockReset();
  crearPedido.mockImplementation(async () => ({ id: "p1", numero: "PED-1", repetido: false, cuotas: null }));
  cotizar.mockReset();
  cotizar.mockImplementation(async (_l: unknown, o: { costoEnvioPara?: (s: number) => number }) => {
    const costoEnvio = o.costoEnvioPara ? o.costoEnvioPara(1000) : 0;
    return { lineas: [{ id: "1", qty: 1 }], hayProblemas: false, subtotal: 1000, iva: 210, costoEnvio, total: 1210 + costoEnvio };
  });
  leerConfigEnvio.mockReset();
  leerConfigEnvio.mockImplementation(async (_db: unknown, opts?: { conMetodos?: boolean }) => ({
    ...CONFIG_ENVIO_DEFAULT,
    ...(opts?.conMetodos ? { metodos: [metodoDePrueba()] } : {}),
  }));
  direccionParaEnvio.mockReset();
  direccionParaEnvio.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/pedidos — envío por zona", () => {
  it("flag APAGADO: igual que siempre (sin costo, sin snapshot, sin tocar las tablas nuevas)", async () => {
    const r = await post({ entregaGeoToken: token(), totalVisto: 1210 });
    expect(r.status).toBe(201);
    expect(leerConfigEnvio).toHaveBeenCalledWith(undefined, { conMetodos: false });
    const datos = datosGuardados();
    expect(datos).not.toHaveProperty("envioZona");
    expect(datos.envioGratis).toBe(false);
    expect(crearPedido.mock.calls[0][2]).toMatchObject({ costoEnvio: 0, total: 1210 });
  });

  describe("flag prendido", () => {
    beforeEach(() => setFlag("envio-por-zona", true));

    it("token válido: el costo de la zona entra al total y viaja el snapshot a crearPedido", async () => {
      const r = await post({ entregaGeoToken: token(), totalVisto: 4210 });
      expect(r.status).toBe(201);
      expect(crearPedido.mock.calls[0][2]).toMatchObject({ costoEnvio: 3000, total: 4210 });
      expect(datosGuardados().envioZona).toMatchObject({
        resultado: { slug: "envio-en-el-dia", zona: "Centro", precio: 3000, costo: 3000, regla: "poligono" },
        punto: { lat: CENTRO.lat, lon: CENTRO.lon },
        sucursalOrigen: "mdp",
      });
      expect(datosGuardados().envioGratis).toBe(false);
    });

    it("el total que ve el comprador (sin envío) ya no coincide: precio_cambio, y con costoEnvioVisto: envio_cambio", async () => {
      const a = await post({ entregaGeoToken: token(), totalVisto: 1210 });
      expect(a.status).toBe(409);
      expect((await a.json()).motivo).toBe("precio_cambio");
      const b = await post({ entregaGeoToken: token(), totalVisto: 1210, costoEnvioVisto: 0 });
      expect(b.status).toBe(409);
      const json = await b.json();
      expect(json.motivo).toBe("envio_cambio");
      expect(json.error).toBe("El costo de envío cambió según su dirección. Revise el nuevo total antes de confirmar.");
      expect(json.totalNuevo).toBe(4210);
      expect(crearPedido).not.toHaveBeenCalled();
    });

    it("lat/lon crudos del body se IGNORAN: sin ubicación verificada no hay precio inventado", async () => {
      const r = await post({ lat: CENTRO.lat, lon: CENTRO.lon, destino: { lat: CENTRO.lat, lon: CENTRO.lon } });
      expect(r.status).toBe(201);
      expect(crearPedido.mock.calls[0][2]).toMatchObject({ costoEnvio: 0 });
      expect(datosGuardados()).not.toHaveProperty("envioZona");
    });

    it("token de otra calle: sin ubicación verificada", async () => {
      const r = await post({ entregaGeoToken: token(), entregaDireccion: "Otra Calle 9" });
      expect(r.status).toBe(201);
      expect(datosGuardados()).not.toHaveProperty("envioZona");
    });

    it("dirección guardada: coordenadas de la base", async () => {
      direccionParaEnvio.mockResolvedValue({ calle: "Calle 1 100", ciudad: "Ciudad", provincia: "Buenos Aires", cp: null, lat: CENTRO.lat, lon: CENTRO.lon });
      const r = await post({ direccionId: "123e4567-e89b-12d3-a456-426614174000" });
      expect(r.status).toBe(201);
      expect(direccionParaEnvio).toHaveBeenCalledWith("user_1", "123e4567-e89b-12d3-a456-426614174000");
      expect(crearPedido.mock.calls[0][2]).toMatchObject({ costoEnvio: 3000 });
    });

    it("por CP (regla respaldo): se cobra la zona sin coordenadas", async () => {
      const r = await post({ destino: { cp: "7600" } });
      expect(r.status).toBe(201);
      expect(datosGuardados().envioZona.resultado).toMatchObject({ zona: "Centro", regla: "cp" });
      expect(datosGuardados().envioZona.punto).toBeNull();
    });

    it("localidad atendida sin ubicar: 409 direccion_sin_ubicar y no se crea nada", async () => {
      const r = await post({ destino: { georefId: "9990010" } });
      expect(r.status).toBe(409);
      const json = await r.json();
      expect(json.motivo).toBe("direccion_sin_ubicar");
      expect(json.error).toBe("Seleccione su dirección de la lista para calcular el envío en el día.");
      expect(crearPedido).not.toHaveBeenCalled();
    });

    it("sin ubicar y el comprador elige el envío a coordinar: costo 0, sin método ni snapshot", async () => {
      const r = await post({ destino: { georefId: "9990010" }, envioACoordinar: true });
      expect(r.status).toBe(201);
      expect(crearPedido.mock.calls[0][2]).toMatchObject({ costoEnvio: 0, total: 1210 });
      expect(datosGuardados()).not.toHaveProperty("envioZona");
    });

    it("envioACoordinar:true con la dirección ya ubicada NO regala el envío", async () => {
      const r = await post({ entregaGeoToken: token(), envioACoordinar: true });
      expect(r.status).toBe(201);
      expect(crearPedido.mock.calls[0][2]).toMatchObject({ costoEnvio: 3000 });
      expect(datosGuardados().envioZona).toBeDefined();
    });

    it("localidad que ningún método atiende: se crea a coordinar, sin pedir ubicación", async () => {
      const r = await post({ destino: { georefId: "9990098" } });
      expect(r.status).toBe(201);
      expect(datosGuardados()).not.toHaveProperty("envioZona");
    });

    it("el origen cambió dentro de la transacción: 409 envio_cambio con la cotización nueva, sin crear", async () => {
      crearPedido.mockRejectedValue(new EnvioCambioError({ sucursal: "igz", conTraslado: false }));
      const r = await post({ entregaGeoToken: token() });
      expect(r.status).toBe(409);
      const json = await r.json();
      expect(json.motivo).toBe("envio_cambio");
      expect(json.error).toBe("El costo de envío cambió según su dirección. Revise el nuevo total antes de confirmar.");
      // Con el origen real (igz) el método no aplica: la cotización nueva queda sin envío.
      expect(json.cotizacion.costoEnvio).toBe(0);
      expect(json.totalNuevo).toBe(1210);
    });

    it("retiro: no suma envío ni lee la dirección", async () => {
      const r = await post({ entregaTipo: "retiro", entregaCiudad: undefined, entregaDireccion: undefined, entregaProvincia: undefined, entregaGeoToken: token() });
      expect(r.status).toBe(201);
      expect(crearPedido.mock.calls[0][2]).toMatchObject({ costoEnvio: 0 });
      expect(datosGuardados()).not.toHaveProperty("envioZona");
      expect(direccionParaEnvio).not.toHaveBeenCalled();
    });
  });
});
