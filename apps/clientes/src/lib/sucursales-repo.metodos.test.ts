import { describe, expect, it, vi } from "vitest";

vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));

import { armarMetodosEnvio, leerConfigEnvio, leerMetodosEnvio } from "./sucursales-repo";
import { CONFIG_ENVIO_DEFAULT } from "./envio";
import { crmMetodosEnvio, crmMetodosEnvioEntradas, crmMetodosEnvioLocalidades, crmMetodosEnvioZonas, crmReglasVenta } from "@/db/crm";

const METODO = {
  id: "m1",
  tenantId: "tenant-ejemplo",
  slug: "envio-en-el-dia",
  nombre: "Envío en el día",
  tipo: "tarifa_zona",
  activo: true,
  orden: 0,
  provinciaClave: "buenosaires",
  sucursalOrigen: "mdp",
  diasOperativos: [1, 2, 3, 4, 5],
  horaCorte: "09:00:00",
  margenMin: 30,
  promesa: "Entrega en el día",
  avisoFeriados: "",
  gratisAplica: false,
  itemAlegraId: "9001",
  itemAlegraIva: "21.00",
  config: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};
const ZONA = {
  id: "z1",
  metodoId: "m1",
  nombre: "Centro",
  precio: "3000.00",
  orden: 1,
  activa: true,
  geometria: [[[[-57.6, -38.1], [-57.5, -38.1], [-57.5, -38.0], [-57.6, -38.0], [-57.6, -38.1]]]],
};
const ENTRADA = { id: "e1", zonaId: "z1", metodoId: "m1", tipo: "cp", valor: "7600", etiqueta: "7600", nombreNorm: "7600" };
const LOCALIDAD = {
  id: "l1",
  metodoId: "m1",
  georefId: "9990010",
  etiqueta: "Ciudad Ejemplo",
  nombreNorm: "ciudadejemplo",
  abreviaturas: ["ce"],
  centroLat: "-38.030000",
  centroLon: "-57.550000",
  bboxSur: "-38.040000",
  bboxOeste: "-57.590000",
  bboxNorte: "-38.020000",
  bboxEste: "-57.510000",
};

describe("armarMetodosEnvio", () => {
  it("convierte numeric/time del CRM a los tipos del módulo puro", () => {
    const [m] = armarMetodosEnvio([METODO], [ZONA], [ENTRADA], [LOCALIDAD]);
    expect(m).toMatchObject({
      slug: "envio-en-el-dia",
      horaCorte: "09:00",
      itemAlegraIva: 21,
      margenMin: 30,
      sucursalOrigen: "mdp",
    });
    expect(m.zonas).toHaveLength(1);
    expect(m.zonas[0]).toMatchObject({ nombre: "Centro", precio: 3000, activa: true });
    expect(m.zonas[0].entradas).toEqual([{ tipo: "cp", valor: "7600", etiqueta: "7600", nombreNorm: "7600" }]);
    expect(m.localidades?.[0]).toMatchObject({
      georefId: "9990010",
      centro: { lat: -38.03, lon: -57.55 },
      bbox: { sur: -38.04, oeste: -57.59, norte: -38.02, este: -57.51 },
      abreviaturas: ["ce"],
    });
  });

  it("localidad sin centro ni caja: null (no se inventa)", () => {
    const l = { ...LOCALIDAD, centroLat: null, centroLon: null, bboxSur: null };
    const [m] = armarMetodosEnvio([METODO], [], [], [l]);
    expect(m.localidades?.[0]).toMatchObject({ centro: null, bbox: null });
  });

  it("zona con geometría que no es una lista: sin dibujo", () => {
    const [m] = armarMetodosEnvio([METODO], [{ ...ZONA, geometria: {} as never }], [], []);
    expect(m.zonas[0].geometria).toEqual([]);
  });

  it("un tipo de método desconocido se descarta", () => {
    expect(armarMetodosEnvio([{ ...METODO, tipo: "flash_km_peso" }], [], [], [])).toEqual([]);
  });

  it("zonas y entradas se reparten sólo a su método / zona", () => {
    const otro = { ...METODO, id: "m2", slug: "otro" };
    const zonaDeOtro = { ...ZONA, id: "z2", metodoId: "m2", nombre: "Otra" };
    const ms = armarMetodosEnvio([METODO, otro], [ZONA, zonaDeOtro], [ENTRADA], []);
    expect(ms[0].zonas.map((z) => z.nombre)).toEqual(["Centro"]);
    expect(ms[1].zonas.map((z) => z.nombre)).toEqual(["Otra"]);
    expect(ms[1].zonas[0].entradas).toEqual([]);
  });
});

/** Doble de la base: responde por la tabla de la que se lee y cuenta las consultas. */
function dbDoble(datos: Map<unknown, unknown[]>, fallar = false) {
  const consultas: unknown[] = [];
  const db = {
    select: () => ({
      from: (tabla: unknown) => {
        consultas.push(tabla);
        return {
          where: async () => {
            if (fallar) throw new Error("relation does not exist");
            return datos.get(tabla) ?? [];
          },
        };
      },
    }),
  };
  return { db, consultas };
}

describe("leerMetodosEnvio", () => {
  it("lee 4 tablas y arma los métodos", async () => {
    const { db, consultas } = dbDoble(
      new Map<unknown, unknown[]>([
        [crmMetodosEnvio, [METODO]],
        [crmMetodosEnvioZonas, [ZONA]],
        [crmMetodosEnvioEntradas, [ENTRADA]],
        [crmMetodosEnvioLocalidades, [LOCALIDAD]],
      ]),
    );
    const r = await leerMetodosEnvio(db as never);
    expect(consultas).toHaveLength(4);
    expect(r).toHaveLength(1);
  });

  it("sin métodos no lee el resto", async () => {
    const { db, consultas } = dbDoble(new Map());
    expect(await leerMetodosEnvio(db as never)).toEqual([]);
    expect(consultas).toHaveLength(1);
  });

  it("si falla la lectura (migración sin aplicar) devuelve [] y no tira", async () => {
    const { db } = dbDoble(new Map(), true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await leerMetodosEnvio(db as never)).toEqual([]);
    log.mockRestore();
  });
});

describe("leerConfigEnvio y el flag envio-por-zona", () => {
  const filaReglas = {
    envioDomicilioActivo: true,
    envioGratisActivo: false,
    envioGratisAlcance: null,
    envioGratisProvincias: [],
    envioGratisMinimoModo: null,
    envioGratisMinimo: null,
  };

  it("sin pedir métodos (flag apagado) no toca las tablas nuevas y no trae `metodos`", async () => {
    const { db, consultas } = dbDoble(new Map<unknown, unknown[]>([[crmReglasVenta, [filaReglas]]]));
    const cfg = await leerConfigEnvio(db as never);
    expect(consultas).toEqual([crmReglasVenta]);
    expect(cfg).toEqual({ domicilioActivo: true, gratis: null });
    expect("metodos" in cfg).toBe(false);
  });

  it("pidiendo métodos (flag prendido) suma `metodos`", async () => {
    const { db } = dbDoble(
      new Map<unknown, unknown[]>([
        [crmReglasVenta, [filaReglas]],
        [crmMetodosEnvio, [METODO]],
        [crmMetodosEnvioZonas, [ZONA]],
      ]),
    );
    const cfg = await leerConfigEnvio(db as never, { conMetodos: true });
    expect(cfg.metodos).toHaveLength(1);
    expect(cfg.domicilioActivo).toBe(true);
  });

  it("pidiendo métodos con las tablas rotas: metodos [] y la regla de la tienda intacta", async () => {
    const { db } = dbDoble(new Map<unknown, unknown[]>([[crmReglasVenta, [filaReglas]]]));
    // Falla sólo la lectura de métodos.
    const roto = {
      select: () => ({
        from: (t: unknown) => ({
          where: async () => {
            if (t === crmReglasVenta) return [filaReglas];
            throw new Error("relation does not exist");
          },
        }),
      }),
    };
    void db;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cfg = await leerConfigEnvio(roto as never, { conMetodos: true });
    log.mockRestore();
    expect(cfg.metodos).toEqual([]);
    expect(cfg.domicilioActivo).toBe(CONFIG_ENVIO_DEFAULT.domicilioActivo);
  });
});
