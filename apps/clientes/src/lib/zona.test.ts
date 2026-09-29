import { describe, expect, it } from "vitest";
import { claveDeCookie, zonaVigente } from "./zona";
import type { DatosSucursales, SucursalVista } from "./sucursales-repo";

const suc = (slug: string, extra: Partial<SucursalVista> = {}): SucursalVista => ({
  slug,
  nombre: `Sucursal ${slug}`,
  ciudad: "Ciudad Ejemplo",
  provincia: "Provincia Ejemplo",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 1,
  activa: true,
  predeterminada: false,
  ...extra,
});

const datos: DatosSucursales = {
  sucursales: [suc("sede-a"), suc("sede-b", { orden: 2, predeterminada: true })],
  zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "sede-a", facturaSucursal: null }],
};

describe("claveDeCookie", () => {
  it("acepta sólo la clave exacta de una provincia conocida", () => {
    expect(claveDeCookie("misiones")).toBe("misiones");
    expect(claveDeCookie("ciudadautonomadebuenosaires")).toBe("ciudadautonomadebuenosaires");
    expect(claveDeCookie("Misiones")).toBeNull();
    expect(claveDeCookie("marte")).toBeNull();
    expect(claveDeCookie("")).toBeNull();
    expect(claveDeCookie(undefined)).toBeNull();
  });
});

describe("zonaVigente", () => {
  it("primera visita: sucursal predeterminada", () => {
    const z = zonaVigente({ datos });
    expect(z.origen).toBe("default");
    expect(z.provinciaClave).toBeNull();
    expect(z.sucursal?.slug).toBe("sede-b");
  });

  it("cookie válida: la sucursal de esa zona", () => {
    const z = zonaVigente({ cookie: "misiones", datos });
    expect(z.origen).toBe("cookie");
    expect(z.sucursal?.slug).toBe("sede-a");
  });

  it("cookie inválida: se ignora y manda el default", () => {
    const z = zonaVigente({ cookie: "atlantida", datos });
    expect(z.origen).toBe("default");
    expect(z.sucursal?.slug).toBe("sede-b");
  });

  it("usuario logueado sin cookie: la provincia del perfil", () => {
    const z = zonaVigente({ perfilProvincia: "Misiones", datos });
    expect(z.origen).toBe("perfil");
    expect(z.provinciaClave).toBe("misiones");
    expect(z.sucursal?.slug).toBe("sede-a");
  });

  it("la cookie le gana al perfil", () => {
    const z = zonaVigente({ cookie: "cordoba", perfilProvincia: "Misiones", datos });
    expect(z.origen).toBe("cookie");
    expect(z.sucursal?.slug).toBe("sede-b");
  });

  it("perfil con una provincia que no es una jurisdicción: default", () => {
    expect(zonaVigente({ perfilProvincia: "Narnia", datos }).origen).toBe("default");
  });

  it("sin ninguna sucursal activa: sin sucursal (no asigna en silencio)", () => {
    const z = zonaVigente({
      datos: { ...datos, sucursales: datos.sucursales.map((s) => ({ ...s, activa: false })) },
    });
    expect(z.sucursal).toBeNull();
  });
});

describe("el catálogo no depende de la zona", () => {
  it("la zona sólo devuelve una sucursal: no hay ningún filtro de productos en su salida", () => {
    const a = zonaVigente({ cookie: "misiones", datos });
    const b = zonaVigente({ cookie: "cordoba", datos });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a)).toEqual(["provinciaClave", "origen", "sucursal", "resolucion"]);
  });
});
