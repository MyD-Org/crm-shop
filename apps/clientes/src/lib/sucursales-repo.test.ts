import { describe, expect, it, vi } from "vitest";

vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));

import { configEnvioDeFila, leerConfigEnvio, leerSucursalesYZonas, type FilaEnvio } from "./sucursales-repo";
import { CONFIG_ENVIO_DEFAULT } from "./envio";
import { getTableColumns } from "drizzle-orm";
import { crmSucursales } from "@/db/crm";

/** La lectura filtra por tenant y sólo pide columnas concedidas por el GRANT del CRM. */
describe("leerSucursalesYZonas", () => {
  it("consulta sucursales y zonas con where de tenant", async () => {
    const wheres: unknown[] = [];
    const db = {
      select: (cols: Record<string, unknown>) => ({
        from: () => ({
          where: async (w: unknown) => {
            wheres.push(w);
            return "slug" in cols ? [{ slug: "s" }] : [{ id: "z" }];
          },
        }),
      }),
    };
    const r = await leerSucursalesYZonas(db as never);
    expect(wheres).toHaveLength(2);
    expect(r).toEqual({ sucursales: [{ slug: "s" }], zonas: [{ id: "z" }] });
  });

  it("no pide columnas fuera del contrato", () => {
    expect(Object.keys(getTableColumns(crmSucursales))).not.toContain(
      "cuentaAlegraId",
    );
  });
});

const FILA: FilaEnvio = {
  envioDomicilioActivo: true,
  envioGratisActivo: true,
  envioGratisAlcance: "provincias",
  envioGratisProvincias: ["misiones", "corrientes"],
  envioGratisMinimoModo: "desde",
  envioGratisMinimo: "100000.00",
};

describe("configEnvioDeFila (fila del CRM -> ConfigEnvio)", () => {
  it("gratis activo y completo: alcance, provincias y mínimo como número", () => {
    expect(configEnvioDeFila(FILA)).toEqual({
      domicilioActivo: true,
      gratis: { alcance: "provincias", provincias: ["misiones", "corrientes"], minimo: 100000 },
    });
  });

  it("gratis apagado (lo que deja la migración): gratis null, domicilio activo", () => {
    expect(
      configEnvioDeFila({ ...FILA, envioGratisActivo: false, envioGratisAlcance: null, envioGratisMinimoModo: null, envioGratisMinimo: null }),
    ).toEqual(CONFIG_ENVIO_DEFAULT);
  });

  it("sin_minimo: mínimo null; todo el país ignora la lista de provincias", () => {
    expect(
      configEnvioDeFila({ ...FILA, envioGratisAlcance: "pais", envioGratisMinimoModo: "sin_minimo", envioGratisMinimo: null }),
    ).toEqual({ domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: null } });
  });

  it("columnas incompletas con gratis activo: nunca 'todo' ni 'sin mínimo', gratis null", () => {
    expect(configEnvioDeFila({ ...FILA, envioGratisAlcance: null }).gratis).toBeNull();
    expect(configEnvioDeFila({ ...FILA, envioGratisMinimoModo: null }).gratis).toBeNull();
    expect(configEnvioDeFila({ ...FILA, envioGratisMinimo: null }).gratis).toBeNull();
    expect(configEnvioDeFila({ ...FILA, envioGratisMinimo: "0.00" }).gratis).toBeNull();
  });

  it("domicilio inactivo se respeta", () => {
    expect(configEnvioDeFila({ ...FILA, envioDomicilioActivo: false }).domicilioActivo).toBe(false);
  });
});

describe("leerConfigEnvio", () => {
  const dbCon = (resultado: () => Promise<unknown[]>) => ({
    select: () => ({ from: () => ({ where: () => ({ limit: resultado }) }) }),
  });

  it("lee la fila del tenant y la mapea", async () => {
    expect(await leerConfigEnvio(dbCon(async () => [FILA]) as never)).toMatchObject({ gratis: { alcance: "provincias" } });
  });

  it("sin fila: el default", async () => {
    expect(await leerConfigEnvio(dbCon(async () => []) as never)).toEqual(CONFIG_ENVIO_DEFAULT);
  });

  it("si la lectura falla (columnas sin migrar, base caída): el default, sin tirar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rota = dbCon(async () => {
      throw new Error('column "envio_domicilio_activo" does not exist');
    });
    expect(await leerConfigEnvio(rota as never)).toEqual(CONFIG_ENVIO_DEFAULT);
  });
});
