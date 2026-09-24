import { describe, expect, it } from "vitest";
import {
  CAPACIDADES_DESPLIEGUE,
  GRUPOS_MI_CUENTA,
  agruparSecciones,
  seccionDesplegada,
  type CapacidadesDespliegue,
  bajadaMiCuenta,
  rutaVincular,
  volverSeguro,
  RUTAS_MI_CUENTA,
  capacidadesDe,
  hrefPedido,
  migasMiCuenta,
  seccionActiva,
  seccionesVisibles,
} from "./mi-cuenta-nav";

const TODO: CapacidadesDespliegue = {
  favoritos: true,
  facturas: true,
  direcciones: true,
  pagos: true,
  presupuestos: true,
  condiciones: true,
  avisos: true,
};
// Direcciones depende del flag `envio`, no de una rebanada: acá queda prendida.
const NADA: CapacidadesDespliegue = {
  favoritos: false,
  facturas: false,
  direcciones: true,
  pagos: false,
  presupuestos: false,
  condiciones: false,
  avisos: false,
};
/** Rebanada 1 de portal-al-shop: sólo "Facturas y saldo" de Facturación. */
const REBANADA_1: CapacidadesDespliegue = { ...NADA, favoritos: true, facturas: true };
/** Rebanada 2 de portal-al-shop: suma Pagos y Presupuestos. */
const REBANADA_2: CapacidadesDespliegue = { ...REBANADA_1, pagos: true, presupuestos: true };
const ids = (s: { id: string }[]) => s.map((x) => x.id);
const cap = (clerk: boolean, vinculado: boolean, esCuentaCorriente = false) => ({ clerk, vinculado, esCuentaCorriente });

/** Navegación de Mi cuenta: secciones por identidad y despliegue (NAV-1, menú agrupado). */
describe("seccionesVisibles", () => {
  it("con el flag envio apagado, Direcciones y envíos no figura", () => {
    const s = seccionesVisibles(cap(true, true), { ...TODO, direcciones: false });
    expect(ids(s)).not.toContain("direcciones");
    expect(ids(s)).toContain("pedidos");
  });

  it("cuenta corriente con todo desplegado: el orden del menú agrupado", () => {
    const s = seccionesVisibles(cap(true, true, true), TODO);
    expect(ids(s)).toEqual([
      "pedidos",
      "favoritos",
      "facturas",
      "pagos",
      "presupuestos",
      "condiciones",
      "avisos",
      "datos",
      "direcciones",
      "seguridad",
      "salir",
    ]);
    expect(s.filter((x) => x.tone === "danger").map((x) => x.id)).toEqual(["salir"]);
    // Seguridad y Cerrar sesión son acciones, no rutas.
    expect(s.find((x) => x.id === "seguridad")?.href).toBeUndefined();
    expect(s.find((x) => x.id === "salir")?.href).toBeUndefined();
    expect(s.find((x) => x.id === "pedidos")?.href).toBe(RUTAS_MI_CUENTA.pedidos);
    expect(s.find((x) => x.id === "datos")?.href).toBe(RUTAS_MI_CUENTA.datos);
    expect(s.find((x) => x.id === "pagos")?.href).toBe("/mi-cuenta/pagos");
  });

  it("rebanada 1 desplegada: Facturas y saldo sí; Pagos, Presupuestos, Condiciones y Avisos no", () => {
    const s = ids(seccionesVisibles(cap(true, true, true), REBANADA_1));
    expect(s).toContain("facturas");
    for (const id of ["pagos", "presupuestos", "condiciones", "avisos"]) expect(s).not.toContain(id);
  });

  it("rebanada 2 desplegada: Facturas y saldo, Pagos y Presupuestos, en ese orden; Condiciones y Avisos no", () => {
    const s = ids(seccionesVisibles(cap(true, true, true), REBANADA_2));
    expect(s.filter((id) => ["facturas", "pagos", "presupuestos", "condiciones", "avisos"].includes(id))).toEqual([
      "facturas",
      "pagos",
      "presupuestos",
    ]);
  });

  it("rebanada 2 sin vínculo: Pagos y Presupuestos no aparecen", () => {
    const s = ids(seccionesVisibles(cap(true, false), REBANADA_2));
    expect(s).toContain("facturas");
    expect(s).not.toContain("pagos");
    expect(s).not.toContain("presupuestos");
  });

  it("contado: todo Facturación menos Condiciones", () => {
    const s = ids(seccionesVisibles(cap(true, true, false), TODO));
    expect(s).toEqual(expect.arrayContaining(["facturas", "pagos", "presupuestos", "avisos"]));
    expect(s).not.toContain("condiciones");
  });

  it("sin vínculo: sólo Facturas y saldo (la página ofrece vincular), aunque el resto esté desplegado", () => {
    const s = ids(seccionesVisibles(cap(true, false, true), TODO));
    expect(s).toContain("facturas");
    for (const id of ["pagos", "presupuestos", "condiciones", "avisos"]) expect(s).not.toContain(id);
  });

  it("cookie del CRM sin Clerk: Pedidos, Facturación y Direcciones y envíos", () => {
    const s = seccionesVisibles(cap(false, true), REBANADA_1);
    expect(ids(s)).toEqual(["pedidos", "facturas", "direcciones"]);
  });

  it("sin Facturación desplegada: 5 entradas para Clerk", () => {
    const s = seccionesVisibles(cap(true, true), NADA);
    expect(ids(s)).toEqual(["pedidos", "datos", "direcciones", "seguridad", "salir"]);
  });

  it("la función es total: sin identidad quedan las secciones públicas", () => {
    expect(ids(seccionesVisibles(cap(false, false), TODO))).toEqual(["pedidos", "facturas", "direcciones"]);
  });

  it("por default usa el despliegue actual: toda Facturación (rebanada 4: Condiciones y Avisos)", () => {
    expect(CAPACIDADES_DESPLIEGUE).toMatchObject({
      favoritos: true,
      facturas: true,
      pagos: true,
      presupuestos: true,
      condiciones: true,
      avisos: true,
    });
    expect(seccionesVisibles(cap(true, true))).toEqual(seccionesVisibles(cap(true, true), CAPACIDADES_DESPLIEGUE));
    expect(ids(seccionesVisibles(cap(true, false)))).toContain("favoritos");
    // La cookie del CRM sin Clerk no tiene dónde guardarlos.
    expect(ids(seccionesVisibles(cap(false, true)))).not.toContain("favoritos");
  });

  it("labels del copy aprobado", () => {
    expect(seccionesVisibles(cap(true, true, true), TODO).map((x) => x.label)).toEqual([
      "Pedidos",
      "Favoritos",
      "Facturas y saldo",
      "Pagos",
      "Presupuestos",
      "Condiciones",
      "Avisos",
      "Mis datos",
      "Direcciones y envíos",
      "Seguridad",
      "Cerrar sesión",
    ]);
  });

  it("badge: sólo si el contador es mayor a 0", () => {
    const con = seccionesVisibles(cap(true, true), TODO, { avisos: 3 });
    expect(con.find((x) => x.id === "avisos")?.badge).toBe(3);
    const sin = seccionesVisibles(cap(true, true), TODO, { avisos: 0 });
    expect(sin.find((x) => x.id === "avisos")).not.toHaveProperty("badge");
    expect(sin.find((x) => x.id === "pedidos")).not.toHaveProperty("badge");
  });
});

describe("agruparSecciones", () => {
  it("Compras online · Facturación · Mi perfil, con Cerrar sesión suelto", () => {
    const { grupos, sueltas } = agruparSecciones(seccionesVisibles(cap(true, true, true), TODO));
    expect(grupos.map((g) => [g.label, ids(g.items)])).toEqual([
      ["Compras online", ["pedidos", "favoritos"]],
      ["Facturación", ["facturas", "pagos", "presupuestos", "condiciones", "avisos"]],
      ["Mi perfil", ["datos", "direcciones", "seguridad"]],
    ]);
    expect(ids(sueltas)).toEqual(["salir"]);
  });

  it("un grupo sin secciones no figura", () => {
    const { grupos } = agruparSecciones(seccionesVisibles(cap(true, true), NADA));
    expect(grupos.map((g) => g.id)).toEqual(["compras", "perfil"]);
  });

  it("nunca 'Cuenta corriente' como título: lo ven también los de contado", () => {
    expect(GRUPOS_MI_CUENTA.map((g) => g.label)).not.toContain("Cuenta corriente");
  });
});

describe("seccionDesplegada", () => {
  it("cada ruta de Facturación sigue su capacidad (apagada ⇒ la página da 404)", () => {
    expect(seccionDesplegada("facturas", REBANADA_1)).toBe(true);
    for (const s of ["pagos", "presupuestos", "condiciones", "avisos"] as const) {
      expect(seccionDesplegada(s, REBANADA_1)).toBe(false);
      expect(seccionDesplegada(s, TODO)).toBe(true);
    }
    expect(seccionDesplegada("pagos", REBANADA_2)).toBe(true);
    expect(seccionDesplegada("presupuestos", REBANADA_2)).toBe(true);
    expect(seccionDesplegada("condiciones", REBANADA_2)).toBe(false);
    expect(seccionDesplegada("condiciones")).toBe(true);
    expect(seccionDesplegada("avisos")).toBe(true);
  });
});

describe("rebanada 4 (Condiciones y Avisos) con el despliegue actual", () => {
  it("contado vinculado: Avisos sí, Condiciones no (sin entrada en el menú)", () => {
    const s = ids(seccionesVisibles(cap(true, true, false)));
    expect(s).toContain("avisos");
    expect(s).not.toContain("condiciones");
  });

  it("cuenta corriente vinculada: Condiciones antes de Avisos, al final de Facturación", () => {
    const s = ids(seccionesVisibles(cap(true, true, true)));
    expect(s.filter((id) => ["facturas", "pagos", "presupuestos", "condiciones", "avisos"].includes(id))).toEqual([
      "facturas",
      "pagos",
      "presupuestos",
      "condiciones",
      "avisos",
    ]);
  });

  it("sin vínculo: ni Condiciones ni Avisos, aunque el espejo dijera corriente", () => {
    const s = ids(seccionesVisibles(capacidadesDe({ clerkUserId: "u", cliente: null }, true)));
    expect(s).not.toContain("condiciones");
    expect(s).not.toContain("avisos");
  });

  it("badge de avisos sin leer en la entrada Avisos", () => {
    const avisos = seccionesVisibles(cap(true, true), undefined, { avisos: 2 }).find((x) => x.id === "avisos");
    expect(avisos).toMatchObject({ grupo: "facturacion", badge: 2 });
  });
});

describe("capacidadesDe", () => {
  it("Clerk y vínculo según la identidad", () => {
    expect(capacidadesDe({ clerkUserId: "user_1", cliente: { codigocliente: "C-1" } })).toEqual(cap(true, true));
    expect(capacidadesDe({ clerkUserId: "user_1", cliente: null })).toEqual(cap(true, false));
    expect(capacidadesDe({ clerkUserId: null, cliente: { codigocliente: "C-1" } })).toEqual(cap(false, true));
    expect(capacidadesDe({ clerkUserId: null, cliente: null })).toEqual(cap(false, false));
  });

  it("cuenta corriente sólo con vínculo", () => {
    expect(capacidadesDe({ clerkUserId: "user_1", cliente: { codigocliente: "C-1" } }, true)).toEqual(
      cap(true, true, true),
    );
    expect(capacidadesDe({ clerkUserId: "user_1", cliente: null }, true)).toEqual(cap(true, false, false));
  });
});

describe("seccionActiva", () => {
  it.each([
    ["/mi-cuenta", "pedidos"],
    ["/mi-cuenta/", "pedidos"],
    ["/mi-cuenta/pedidos", "pedidos"],
    ["/mi-cuenta/pedidos/9f1c", "pedidos"],
    ["/mi-cuenta/facturas?pagina=2", "facturas"],
    ["/mi-cuenta/pagos", "pagos"],
    ["/mi-cuenta/presupuestos", "presupuestos"],
    ["/mi-cuenta/condiciones", "condiciones"],
    ["/mi-cuenta/avisos", "avisos"],
    ["/mi-cuenta/favoritos", "favoritos"],
    ["/mi-cuenta/direcciones", "direcciones"],
    ["/mi-cuenta/datos", "datos"],
    ["/mi-cuenta/vincular", "datos"],
    ["/mi-cuenta/lo-que-sea", "pedidos"],
  ])("%s → %s", (pathname, esperado) => {
    expect(seccionActiva(pathname)).toBe(esperado);
  });
});

describe("migasMiCuenta", () => {
  it("resumen: Inicio / Mi cuenta, el último sin enlace", () => {
    expect(migasMiCuenta("/mi-cuenta")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta" },
    ]);
  });

  it("una sección: Inicio / Mi cuenta / sección", () => {
    expect(migasMiCuenta("/mi-cuenta/favoritos")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Favoritos" },
    ]);
    expect(migasMiCuenta("/mi-cuenta/direcciones")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Direcciones y envíos" },
    ]);
  });

  it("detalle de pedido: Pedidos queda como enlace (el número lo agrega quien tiene el pedido)", () => {
    expect(migasMiCuenta("/mi-cuenta/pedidos/x")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Pedidos", href: "/mi-cuenta/pedidos" },
    ]);
  });

  it("la lista de pedidos: Pedidos es el último, sin enlace", () => {
    expect(migasMiCuenta("/mi-cuenta/pedidos").at(-1)).toEqual({ label: "Pedidos" });
  });

  it("secciones de Facturación", () => {
    expect(migasMiCuenta("/mi-cuenta/facturas").at(-1)).toEqual({ label: "Facturas y saldo" });
    expect(migasMiCuenta("/mi-cuenta/pagos").at(-1)).toEqual({ label: "Pagos" });
    expect(migasMiCuenta("/mi-cuenta/condiciones").at(-1)).toEqual({ label: "Condiciones" });
    expect(migasMiCuenta("/mi-cuenta/avisos").at(-1)).toEqual({ label: "Avisos" });
  });

  it("vincular cuelga de Mis datos", () => {
    expect(migasMiCuenta("/mi-cuenta/vincular")).toEqual([
      { label: "Inicio", href: "/" },
      { label: "Mi cuenta", href: "/mi-cuenta" },
      { label: "Mis datos", href: "/mi-cuenta/datos" },
      { label: "Vincule su cuenta de cliente" },
    ]);
  });

  it("ignora query y barra final", () => {
    expect(migasMiCuenta("/mi-cuenta/facturas/?pagina=3")).toEqual(migasMiCuenta("/mi-cuenta/facturas"));
  });
});

describe("rutas", () => {
  it("hrefPedido cuelga de la lista de pedidos", () => {
    expect(hrefPedido("9f1c")).toBe("/mi-cuenta/pedidos/9f1c");
  });

  it("todas las rutas viven bajo /mi-cuenta", () => {
    for (const ruta of Object.values(RUTAS_MI_CUENTA)) expect(ruta).toMatch(/^\/mi-cuenta(\/|$)/);
  });
});

describe("registro", () => {
  it("ningún texto con tuteo ni voseo", () => {
    const rutas = [
      "/mi-cuenta",
      ...Object.values(RUTAS_MI_CUENTA),
      "/mi-cuenta/pedidos/x",
    ];
    const textos = [
      ...seccionesVisibles(cap(true, true, true), TODO).map((x) => x.label),
      ...GRUPOS_MI_CUENTA.map((g) => g.label),
      ...rutas.flatMap((r) => migasMiCuenta(r).map((m) => m.label)),
    ].join(" ");
    expect(textos).not.toMatch(/\b(tu|tus|te|vos)\b/i);
  });
});

describe("bajadaMiCuenta", () => {
  it("sin facturas ni favoritos desplegados no los promete", () => {
    const texto = bajadaMiCuenta(NADA);
    expect(texto).toBe("Siga sus pedidos y administre sus direcciones y datos.");
    expect(texto).not.toMatch(/factura|favorito/i);
  });

  it("sin direcciones no las menciona", () => {
    expect(bajadaMiCuenta({ ...NADA, direcciones: false })).toBe(
      "Siga sus pedidos y administre sus datos.",
    );
  });

  it("con todo desplegado menciona facturas y favoritos", () => {
    expect(bajadaMiCuenta(TODO)).toBe(
      "Siga sus pedidos, consulte sus facturas y su saldo, guarde sus favoritos y administre sus direcciones y datos.",
    );
  });

  it("por defecto usa lo desplegado hoy", () => {
    expect(bajadaMiCuenta()).toBe(bajadaMiCuenta(CAPACIDADES_DESPLIEGUE));
  });
});

describe("volverSeguro / rutaVincular", () => {
  it("acepta sólo rutas internas", () => {
    expect(volverSeguro("/checkout")).toBe("/checkout");
    expect(volverSeguro(["/mi-cuenta"])).toBe("/mi-cuenta");
    expect(volverSeguro("//otro.example")).toBeUndefined();
    expect(volverSeguro("https://otro.example")).toBeUndefined();
    expect(volverSeguro("/\\otro.example")).toBeUndefined();
    expect(volverSeguro(undefined)).toBeUndefined();
  });

  it("arma el enlace con o sin vuelta", () => {
    expect(rutaVincular()).toBe("/mi-cuenta/vincular");
    expect(rutaVincular("/checkout")).toBe("/mi-cuenta/vincular?volver=%2Fcheckout");
    expect(rutaVincular("//otro.example")).toBe("/mi-cuenta/vincular");
  });
});
