import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { cotizar } from "@/lib/cotizacion";
import { crearPedido, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import { EnvioCambioError } from "@/lib/envio-snapshot";
import { cotizarMetodo } from "@/lib/envio-zona";
import { metodoDePrueba, puntoDePrueba } from "@/test/envio-metodo";
import { assertLocalTestDb } from "./db-url";

/**
 * Crear un pedido con envío por zona (change `envio-por-zona-con-tarifa`) contra Postgres REAL (local,
 * datos inventados): el costo y el snapshot quedan congelados, el retiro y el envío a coordinar dejan
 * las columnas en NULL y el origen se re-verifica con la asignación real dentro de la transacción.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const GENERAL = "00000000-0000-4000-8000-0000000000a1";
const cliente: DatosCliente = { clerkUserId: "user_ana", email: "ana@cliente.example" };
const base: DatosPedido = {
  contactoNombre: "Cliente",
  contactoTelefono: "1100000000",
  entregaTipo: "envio",
  entregaCiudad: "Ciudad Ejemplo",
  entregaDireccion: "Calle Ejemplo 123",
  pagoMetodo: "transferencia",
};

const metodo = metodoDePrueba();
const resultado = cotizarMetodo(
  metodo,
  { provinciaClave: "buenosaires", punto: puntoDePrueba("centro") },
  { origen: { sucursal: "mdp", conTraslado: false }, subtotalSinIva: 1000, gratisTienda: false, gratisCupon: false },
)!;
const envioZona = { resultado, punto: { lat: -38.0, lon: -57.58 }, sucursalOrigen: "mdp" };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts restart identity cascade`);
  });
}

async function sembrar() {
  const db = getDb();
  await db.execute(sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`);
  const precio = JSON.stringify([{ idPriceList: GENERAL, name: "General", price: 1000, main: true }]);
  await db.execute(sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online)
                       values (${TENANT}, 'N1', 'Normal', 50, 'active', 'active', 21, ${precio}::jsonb)`);
  await db.execute(sql`insert into public.sucursales (tenant_id, slug, nombre, predeterminada, orden)
                       values (${TENANT}, 'mdp', 'Mar del Plata', true, 1), (${TENANT}, 'igz', 'Iguazú', false, 2)`);
  await db.execute(sql`insert into public.zonas (tenant_id, provincia_clave, provincia, sucursal)
                       values (${TENANT}, 'buenosaires', 'Buenos Aires', 'mdp'), (${TENANT}, 'misiones', 'Misiones', 'igz')`);
}

const cotizacionConEnvio = (costo: number) =>
  cotizar([{ id: "N1", qty: 1 }], { costoEnvioPara: () => costo });

type Fila = Record<string, unknown>;
const pedidoDe = async (id: string) =>
  ((await getDb().execute(sql`select * from shop.orders where id = ${id}`)) as unknown as Fila[])[0];

beforeEach(async () => {
  await limpiar();
  await sembrar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("crearPedido con envío por zona", () => {
  it("congela el costo (en el total) y el snapshot del método, la zona, la promesa y el detalle", async () => {
    const c = await cotizacionConEnvio(3000);
    expect(c.total).toBe(4210);
    const { id } = await crearPedido(cliente, { ...base, envioZona }, c);
    const o = await pedidoDe(id);
    expect(Number(o.costo_envio)).toBe(3000);
    expect(Number(o.total)).toBe(4210);
    expect(o).toMatchObject({ envio_metodo: "envio-en-el-dia", envio_zona: "Centro", envio_promesa: "Entrega en el día" });
    expect(o.envio_confirmado_en).toBeNull();
    expect(o.envio_entrega_confirmada).toBeNull();
    expect(typeof o.envio_entrega_estimada).toBe("string");
    expect(o.envio_detalle).toMatchObject({
      v: 1,
      slug: "envio-en-el-dia",
      zona: "Centro",
      precio: 3000,
      regla: "poligono",
      precision: "altura",
      punto: { lat: -38, lon: -57.58 },
      alegra: { itemId: "9001", ivaPct: 21 },
      medioOnline: false,
    });
  });

  it("cambios posteriores en el método del CRM no alteran un pedido ya creado", async () => {
    const { id } = await crearPedido(cliente, { ...base, envioZona }, await cotizacionConEnvio(3000));
    // El pedido guarda su propio snapshot: no hay nada que releer del método.
    const antes = await pedidoDe(id);
    metodo.zonas[0].precio = 99_999;
    const despues = await pedidoDe(id);
    metodo.zonas[0].precio = 3000;
    expect(despues.envio_detalle).toEqual(antes.envio_detalle);
    expect(Number(despues.costo_envio)).toBe(3000);
  });

  it("retiro o envío a coordinar (sin método): las columnas del envío quedan NULL", async () => {
    const { id } = await crearPedido(
      cliente,
      { ...base, entregaTipo: "retiro", entregaCiudad: undefined, entregaDireccion: undefined },
      await cotizar([{ id: "N1", qty: 1 }]),
    );
    const o = await pedidoDe(id);
    expect(Number(o.costo_envio)).toBe(0);
    for (const k of ["envio_metodo", "envio_zona", "envio_promesa", "envio_entrega_estimada", "envio_confirmado_en", "envio_entrega_confirmada", "envio_detalle"]) {
      expect(o[k], k).toBeNull();
    }
  });

  it("flag apagado (sin envioZona): el pedido es el de siempre aunque sea a domicilio", async () => {
    const { id } = await crearPedido(cliente, base, await cotizar([{ id: "N1", qty: 1 }]));
    const o = await pedidoDe(id);
    expect(o.envio_detalle).toBeNull();
    expect(Number(o.costo_envio)).toBe(0);
  });

  describe("re-verificación del origen con la asignación real", () => {
    const conSucursal = (provincia: string): DatosPedido => ({
      ...base,
      envioZona,
      sucursalEntrada: { entregaTipo: "envio", provincia, ciudad: "Ciudad Ejemplo", sucursalRetiro: null },
    });

    it("la sucursal asignada es la de origen: el pedido se crea", async () => {
      const { id } = await crearPedido(cliente, conSucursal("buenosaires"), await cotizacionConEnvio(3000));
      expect((await pedidoDe(id)).envio_metodo).toBe("envio-en-el-dia");
    });

    it("la asignación real es OTRA sucursal: EnvioCambioError y no se crea nada", async () => {
      const err = await crearPedido(cliente, conSucursal("misiones"), await cotizacionConEnvio(3000)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EnvioCambioError);
      expect((err as EnvioCambioError).origen).toEqual({ sucursal: "igz", conTraslado: false });
      const [{ n }] = (await getDb().execute(sql`select count(*)::int as n from shop.orders`)) as unknown as { n: number }[];
      expect(n).toBe(0);
    });
  });
});
