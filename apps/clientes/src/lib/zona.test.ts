import { describe, expect, it } from "vitest";
import { aplicarRetiro, claveDeCookie, opcionesCheckout, zonaVigente } from "./zona";
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

describe("aplicarRetiro (el retiro elegido fija la sucursal)", () => {
  // Misiones lo atiende sede-a; el visitante retira en sede-b.
  const zonaB = () => zonaVigente({ perfilProvincia: "misiones", datos });

  it("retiro en una sucursal distinta de la de la provincia: manda la elegida", () => {
    const z = aplicarRetiro(zonaB(), "sede-b", datos);
    expect(z?.sucursal?.slug).toBe("sede-b");
    expect(z?.origen).toBe("cookie");
    expect(z?.provinciaClave).toBe("misiones");
  });

  it("sin retiro (envío o sin elección) la zona queda como está", () => {
    const base = zonaB();
    expect(aplicarRetiro(base, null, datos)).toBe(base);
    expect(aplicarRetiro(base, undefined, datos)).toBe(base);
  });

  it("slug que no es un local activo con retiro: se descarta", () => {
    const d: DatosSucursales = {
      ...datos,
      sucursales: [suc("sede-a"), suc("sede-b", { aceptaRetiro: false }), suc("sede-c", { activa: false })],
    };
    const base = zonaVigente({ perfilProvincia: "misiones", datos: d });
    expect(aplicarRetiro(base, "sede-b", d)).toBe(base);
    expect(aplicarRetiro(base, "sede-c", d)).toBe(base);
    expect(aplicarRetiro(base, "no-existe", d)).toBe(base);
  });

  it("sin zona previa (null) arma una zona sintética con la sucursal elegida", () => {
    const z = aplicarRetiro(null, "sede-a", datos);
    expect(z?.sucursal?.slug).toBe("sede-a");
    expect(z?.provinciaClave).toBeNull();
  });

  it("sin zona y sin retiro sigue siendo null", () => {
    expect(aplicarRetiro(null, null, datos)).toBeNull();
  });

  it("el checkout preselecciona el local elegido", () => {
    const z = aplicarRetiro(zonaB(), "sede-b", datos)!;
    expect(opcionesCheckout(z, datos).localInicial).toBe("sede-b");
  });
});
