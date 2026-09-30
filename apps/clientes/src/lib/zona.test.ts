import { describe, expect, it } from "vitest";
import { claveDeCookie, opcionesCheckout, provinciaDeGeoIp, zonaVigente } from "./zona";
import type { DatosSucursales, SucursalVista } from "./sucursales-repo";

const suc = (
  slug: string,
  extra: Partial<SucursalVista> = {},
): SucursalVista => ({
  slug,
  nombre: `Sucursal ${slug}`,
  ciudad: "Ciudad Ejemplo",
  provincia: "Provincia Ejemplo",
  direccion: "Calle Ejemplo 123",
  horario: "Lunes a viernes de 9 a 18",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 1,
  activa: true,
  predeterminada: false,
  ...extra,
});

const datos: DatosSucursales = {
  sucursales: [
    suc("sede-a"),
    suc("sede-b", { orden: 2, predeterminada: true }),
  ],
  zonas: [
    {
      id: "z1",
      provinciaClave: "misiones",
      sucursal: "sede-a",
      facturaSucursal: null,
    },
  ],
};

describe("claveDeCookie", () => {
  it("acepta sólo la clave exacta de una provincia conocida", () => {
    expect(claveDeCookie("misiones")).toBe("misiones");
    expect(claveDeCookie("ciudadautonomadebuenosaires")).toBe(
      "ciudadautonomadebuenosaires",
    );
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
    const z = zonaVigente({
      cookie: "cordoba",
      perfilProvincia: "Misiones",
      datos,
    });
    expect(z.origen).toBe("cookie");
    expect(z.sucursal?.slug).toBe("sede-b");
  });

  it("perfil con una provincia que no es una jurisdicción: default", () => {
    expect(zonaVigente({ perfilProvincia: "Narnia", datos }).origen).toBe(
      "default",
    );
  });

  it("sin ninguna sucursal activa: sin sucursal (no asigna en silencio)", () => {
    const z = zonaVigente({
      datos: {
        ...datos,
        sucursales: datos.sucursales.map((s) => ({ ...s, activa: false })),
      },
    });
    expect(z.sucursal).toBeNull();
  });
});

describe("el catálogo no depende de la zona", () => {
  it("la zona sólo devuelve una sucursal: no hay ningún filtro de productos en su salida", () => {
    const a = zonaVigente({ cookie: "misiones", datos });
    const b = zonaVigente({ cookie: "cordoba", datos });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a)).toEqual([
      "provinciaClave",
      "origen",
      "sucursal",
      "resolucion",
    ]);
  });
});

describe("opcionesCheckout", () => {
  const z = (cookie?: string) => zonaVigente({ cookie, datos });
  it("preselecciona el local de la zona si admite retiro y la provincia de la zona", () => {
    const o = opcionesCheckout(z("misiones"), datos);
    expect(o.localInicial).toBe("sede-a");
    expect(o.provinciaInicial).toBe("misiones");
    expect(o.locales.map((l) => l.slug)).toEqual(["sede-a", "sede-b"]);
    expect(o.locales[0]).toEqual({
      slug: "sede-a",
      nombre: "Sucursal sede-a",
      direccion: "Calle Ejemplo 123",
      horario: "Lunes a viernes de 9 a 18",
    });
  });

  it("sin zona elegida: la predeterminada y sin provincia", () => {
    const o = opcionesCheckout(z(), datos);
    expect(o.localInicial).toBe("sede-b");
    expect(o.provinciaInicial).toBeNull();
  });

  it("si la sucursal de la zona no admite retiro, cae en la predeterminada; los inactivos no se ofrecen", () => {
    const d: DatosSucursales = {
      ...datos,
      sucursales: [
        suc("sede-a", { aceptaRetiro: false }),
        suc("sede-b", { orden: 2, predeterminada: true }),
        suc("sede-c", { orden: 3, activa: false }),
      ],
    };
    const o = opcionesCheckout(
      zonaVigente({ cookie: "misiones", datos: d }),
      d,
    );
    expect(o.localInicial).toBe("sede-b");
    expect(o.locales.map((l) => l.slug)).toEqual(["sede-b"]);
  });
});

describe("provinciaDeGeoIp", () => {
  it("traduce el código ISO 3166-2 de Argentina a la provincia", () => {
    expect(provinciaDeGeoIp("AR", "N")).toBe("Misiones");
    expect(provinciaDeGeoIp("ar", "b")).toBe("Buenos Aires");
    expect(provinciaDeGeoIp("AR", "AR-C")).toBe("Ciudad Autónoma de Buenos Aires");
  });

  it("fuera de Argentina, sin región o con un código desconocido no sugiere nada", () => {
    expect(provinciaDeGeoIp("PY", "N")).toBeNull();
    expect(provinciaDeGeoIp("AR", null)).toBeNull();
    expect(provinciaDeGeoIp("AR", "I")).toBeNull();
    expect(provinciaDeGeoIp(null, null)).toBeNull();
  });
});

describe("zonaVigente con la provincia sugerida por la IP", () => {
  it("la IP decide sólo si no hay cookie ni perfil", () => {
    const porIp = zonaVigente({ ipProvincia: "Misiones", datos });
    expect(porIp.origen).toBe("ip");
    expect(porIp.provinciaClave).toBe("misiones");
    expect(porIp.sucursal?.slug).toBe("sede-a");
  });

  it("el perfil y la cookie mandan sobre la IP", () => {
    expect(zonaVigente({ perfilProvincia: "Córdoba", ipProvincia: "Misiones", datos }).origen).toBe("perfil");
    expect(zonaVigente({ cookie: "cordoba", ipProvincia: "Misiones", datos }).origen).toBe("cookie");
  });

  it("una provincia por IP desconocida cae en la predeterminada", () => {
    const z = zonaVigente({ ipProvincia: "Atlántida", datos });
    expect(z.origen).toBe("default");
    expect(z.sucursal?.slug).toBe("sede-b");
  });
});
