import { describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

vi.mock("./tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));

const dbActual = { db: null as unknown };
vi.mock("@/db", () => ({ getDb: () => dbActual.db }));

import { leerMediosPago, leerMediosPagoTolerante } from "./medios-pago-repo";
import { leerMensajeConfirmacion, leerWhatsappSucursal } from "./contacto-pedido-repo";

/** Postgres: relación inexistente (42P01) / columna inexistente (42703), como sin la migración del CRM. */
const dbQueTira = (mensaje: string) => ({
  select: () => ({
    from: () => ({
      where: () => {
        const q: Promise<never> & { orderBy?: unknown; limit?: unknown } = Promise.reject(new Error(mensaje));
        q.catch(() => {});
        (q as { orderBy: unknown }).orderBy = () => Promise.reject(new Error(mensaje));
        (q as { limit: unknown }).limit = () => Promise.reject(new Error(mensaje));
        return q;
      },
    }),
  }),
});

const UUID_LISTA = "5b0c0a7e-1d6e-4c1b-8e2a-6c1f4d9a0b11";

describe("leerMediosPago", () => {
  it("pide sólo columnas declaradas, del tenant, ordenadas; la lista sale de las condiciones (pago único)", async () => {
    const g = dbGrabadora((c) =>
      c.sql.includes('"forma"')
        ? []
        : c.sql.includes("lista_precio_condiciones")
        ? [["efectivo", UUID_LISTA, null]]
        : c.sql.includes("opciones_cobro")
          ? [["efectivo", ["credito", "debito", "cuenta_mp"]]]
          : [["efectivo", "Efectivo", "", true, true, false, false, 1, true, false, "publico", [{ texto: "15% OFF", tono: "exito" }]]],
    );
    const r = await leerMediosPago(g.db as never);
    expect(r).toEqual([
      {
        slug: "efectivo",
        nombre: "Efectivo",
        instrucciones: "",
        activo: true,
        aplicaRetiro: true,
        aplicaEnvio: false,
        cobroOnline: false,
        orden: 1,
        idListaPrecios: UUID_LISTA,
        condicionesCuotas: [],
        destacarEnCatalogo: true,
        mostrarEnFicha: false,
        audiencia: "publico",
        chips: [{ texto: "15% OFF", tono: "exito" }],
        opcionesCobro: ["credito", "debito", "cuenta_mp"],
      },
    ]);
    const medios = g.consultas[0];
    expect(medios.sql).toContain('"public"."medios_pago_shop"');
    expect(medios.sql).toContain('"tenant_id" = $1');
    expect(medios.sql).toContain("order by");
    expect(medios.sql).not.toContain("id_lista_precios"); // columna borrada por la 0065
    expect(medios.params).toContain("tenant-ejemplo");
    const cond = g.consultas[1];
    expect(cond.sql).toContain('"public"."lista_precio_condiciones"');
    expect(cond.sql).toContain('"tenant_id" = $1');
    expect(cond.sql).not.toContain('"cuotas" is null'); // trae también las condiciones de cuotas
    expect(cond.params).toContain("tenant-ejemplo");
  });

  it("la audiencia viene de la columna; lo desconocido se trata como público", async () => {
    const g = dbGrabadora(() => [
      ["efectivo-cheque", "Efectivo o cheque", "", true, true, true, false, 0, false, false, "cuenta_corriente"],
      ["raro", "Raro", "", true, true, true, false, 1, false, false, "otra-cosa"],
    ]);
    const r = await leerMediosPago(g.db as never);
    expect(r.map((m) => m.audiencia)).toEqual(["cuenta_corriente", "publico"]);
    expect(g.consultas[0].sql).toContain('"audiencia"');
  });

  it("las etiquetas (chips) se leen de la columna del CRM, tolerantes: ausente o inválido da []", async () => {
    const buenos = [
      { texto: "Hasta 8 cuotas sin interés", tono: "destacado" },
      { texto: "Recomendado", tono: "info" },
    ];
    const g = dbGrabadora(() => [
      ["a", "A", "", true, true, true, false, 0, false, false, "publico", buenos],
      ["b", "B", "", true, true, true, false, 1, false, false, "publico", "no-es-una-lista"],
      ["c", "C", "", true, true, true, false, 2, false, false, "publico", [{ texto: "<b>x</b>", tono: "info" }, 7]],
      ["d", "D", "", true, true, true, false, 3, false, false, "publico", null],
    ]);
    const r = await leerMediosPago(g.db as never);
    expect(r.map((m) => m.chips)).toEqual([buenos, [], [], []]);
    expect(g.consultas[0].sql).toContain('"chips"');
  });

  it("un medio sin condición no tiene lista: rige la de referencia", async () => {
    const g = dbGrabadora((c) =>
      c.sql.includes('"forma"')
        ? []
        : c.sql.includes("lista_precio_condiciones")
        ? [["otro", UUID_LISTA, null]]
        : [["efectivo", "Efectivo", "", true, true, true, false, 0, false, false, "publico"]],
    );
    expect((await leerMediosPago(g.db as never))[0]).toMatchObject({ slug: "efectivo", idListaPrecios: null });
  });

  it("las condiciones con cuotas (N >= 2) salen como condicionesCuotas, ascendentes; el pago único no se mezcla", async () => {
    const L3 = "00000000-0000-4000-8000-000000000003";
    const L6 = "00000000-0000-4000-8000-000000000006";
    const g = dbGrabadora((c) =>
      c.sql.includes('"forma"') || c.sql.includes('"marcas"')
        ? []
        : c.sql.includes("lista_precio_condiciones")
          ? [
              ["mercadopago", L6, 6, "60000.00"],
              ["mercadopago", UUID_LISTA, null, null],
              ["mercadopago", L3, 3, null],
              ["efectivo", L3, null, null],
            ]
          : [["mercadopago", "Mercado Pago", "", true, true, true, true, 0, false, false, "publico"]],
    );
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.idListaPrecios).toBe(UUID_LISTA);
    expect(mp.condicionesCuotas).toEqual([
      { cuotas: 3, idListaPrecios: L3, montoMinimo: null, marcas: null },
      { cuotas: 6, idListaPrecios: L6, montoMinimo: 60000, marcas: null },
    ]);
  });

  it("migración 0065 pendiente (tabla inexistente o sin permiso): los medios siguen, sin lista", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const code of ["42P01", "42501"]) {
      const g = dbGrabadora((c) => {
        if (c.sql.includes("lista_precio_condiciones")) throw Object.assign(new Error("no hay condiciones"), { code });
        return [["transferencia", "Transferencia", "", true, true, true, false, 0, true, true, "publico"]];
      });
      const r = await leerMediosPagoTolerante(g.db as never);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ slug: "transferencia", idListaPrecios: null, condicionesCuotas: [], destacarEnCatalogo: true, mostrarEnFicha: true });
    }
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("otro error al leer las condiciones no se disfraza: tira", async () => {
    const g = dbGrabadora((c) => {
      if (c.sql.includes("lista_precio_condiciones")) throw Object.assign(new Error("boom"), { code: "XX000" });
      return [["efectivo", "Efectivo", "", true, true, false, false, 1, false, false, "publico"]];
    });
    await expect(leerMediosPago(g.db as never)).rejects.toThrow(/lista_precio_condiciones/);
  });

  it("tira si la tabla de medios no existe (lo tolera la variante tolerante)", async () => {
    const g = dbGrabadora(() => {
      throw Object.assign(new Error('relation "public.medios_pago_shop" does not exist'), { code: "42P01" });
    });
    await expect(leerMediosPago(g.db as never)).rejects.toThrow();
    expect(g.consultas).toHaveLength(1);
  });

  it("tira si la tabla no existe (variante con db que rechaza)", async () => {
    await expect(leerMediosPago(dbQueTira('relation "public.medios_pago_shop" does not exist') as never)).rejects.toThrow();
  });
});

describe("formas de pago del cobro en línea (migración 0073 del CRM)", () => {
  const MP = ["mercadopago", "Mercado Pago", "", true, true, true, true, 0, false, false, "publico"];
  const conOpciones = (opciones: (c: { sql: string }) => unknown[][]) =>
    dbGrabadora((c) =>
      c.sql.includes('"forma"')
        ? []
        : c.sql.includes("lista_precio_condiciones") ? [] : c.sql.includes("opciones_cobro") ? opciones(c) : [MP],
    );

  it("las lee en una consulta aparte, del tenant; desconocidas se descartan y vacío queda vacío", async () => {
    const g = conOpciones(() => [["mercadopago", ["cuenta_mp", "efectivo"]], ["payway", []]]);
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.opcionesCobro).toEqual(["cuenta_mp"]);
    const consulta = g.consultas.find((c) => c.sql.includes("opciones_cobro"))!;
    expect(consulta.sql).toContain('"public"."medios_pago_shop"');
    expect(consulta.params).toContain("tenant-ejemplo");
    // La consulta principal no la pide: una columna ausente no puede tirar la lectura de los medios.
    expect(g.consultas[0].sql).not.toContain("opciones_cobro");
  });

  it("vacío explícito se conserva (nunca se lee como todas)", async () => {
    const g = conOpciones(() => [["mercadopago", []]]);
    expect((await leerMediosPago(g.db as never))[0].opcionesCobro).toEqual([]);
  });

  it("columna ausente (42703): los medios siguen, sin el campo (= todas las del procesador)", async () => {
    const g = conOpciones(() => {
      throw Object.assign(new Error('column "opciones_cobro" does not exist'), { code: "42703" });
    });
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.slug).toBe("mercadopago");
    expect("opcionesCobro" in mp).toBe(false);
  });

  it("otro error al leerlas no se disfraza: tira", async () => {
    const g = conOpciones(() => {
      throw Object.assign(new Error("se cortó la conexión"), { code: "08006" });
    });
    await expect(leerMediosPago(g.db as never)).rejects.toThrow();
  });
});

describe("marcas de las condiciones de cuotas (migración 0074 del CRM)", () => {
  const MP = ["mercadopago", "Mercado Pago", "", true, true, true, true, 0, false, false, "publico"];
  const L3 = "00000000-0000-4000-8000-000000000003";
  const L6 = "00000000-0000-4000-8000-000000000006";
  const conMarcas = (marcas: (c: { sql: string }) => unknown[][]) =>
    dbGrabadora((c) =>
      c.sql.includes('"forma"')
        ? []
        : c.sql.includes('"marcas"')
        ? marcas(c)
        : c.sql.includes("lista_precio_condiciones")
          ? [
              ["mercadopago", L3, 3, null],
              ["mercadopago", L6, 6, null],
            ]
          : c.sql.includes("opciones_cobro")
            ? []
            : [MP],
    );

  it("las lee en una consulta aparte, del tenant; null = todas, desconocidas se descartan", async () => {
    const g = conMarcas(() => [
      ["mercadopago", 3, null],
      ["mercadopago", 6, ["visa", "nativa"]],
    ]);
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.condicionesCuotas!.map((c) => [c.cuotas, c.marcas])).toEqual([
      [3, null],
      [6, ["visa"]],
    ]);
    const consulta = g.consultas.find((c) => c.sql.includes('"marcas"'))!;
    expect(consulta.sql).toContain('"public"."lista_precio_condiciones"');
    expect(consulta.params).toContain("tenant-ejemplo");
    // La consulta de condiciones no la pide: una columna ausente no puede tirar las condiciones.
    expect(g.consultas.filter((c) => c.sql.includes("lista_precio_condiciones") && !c.sql.includes('"marcas"') && !c.sql.includes('"forma"'))).toHaveLength(1);
  });

  it("una restricción que queda vacía tras filtrar hace la condición inaccesible: no se ofrece, con aviso", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = conMarcas(() => [["mercadopago", 6, ["nativa"]]]);
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.condicionesCuotas!.map((c) => c.cuotas)).toEqual([3]);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("columna ausente (42703): las condiciones siguen, para todas las tarjetas", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = conMarcas(() => {
      throw Object.assign(new Error('column "marcas" does not exist'), { code: "42703" });
    });
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.condicionesCuotas!.map((c) => [c.cuotas, c.marcas])).toEqual([
      [3, null],
      [6, null],
    ]);
    aviso.mockRestore();
  });

  it("otro error al leerlas no se disfraza: tira", async () => {
    const g = conMarcas(() => {
      throw Object.assign(new Error("se cortó la conexión"), { code: "08006" });
    });
    await expect(leerMediosPago(g.db as never)).rejects.toThrow();
  });

  it("sin condiciones de cuotas no consulta las marcas", async () => {
    const g = dbGrabadora((c) => (c.sql.includes("lista_precio_condiciones") || c.sql.includes("opciones_cobro") ? [] : [MP]));
    await leerMediosPago(g.db as never);
    expect(g.consultas.some((c) => c.sql.includes('"marcas"'))).toBe(false);
  });
});

describe("leerMediosPagoTolerante: la migración del CRM puede no estar aplicada", () => {
  it("tabla inexistente: devuelve [] (el pago sale a_coordinar)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await leerMediosPagoTolerante(dbQueTira('relation "public.medios_pago_shop" does not exist') as never);
    expect(r).toEqual([]);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("permiso denegado: también []", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await leerMediosPagoTolerante(dbQueTira("permission denied for table medios_pago_shop") as never)).toEqual([]);
    aviso.mockRestore();
  });
});

describe("mensaje_confirmacion y WhatsApp: tolerantes a la migración ausente", () => {
  it("columna inexistente: mensaje vacío (texto por defecto), sin tirar", async () => {
    dbActual.db = dbQueTira('column "mensaje_confirmacion" does not exist');
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await leerMensajeConfirmacion()).toBe("");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("con la columna presente devuelve el texto del operador", async () => {
    dbActual.db = dbGrabadora(() => [["Le responderemos dentro de {plazo}."]]).db;
    expect(await leerMensajeConfirmacion()).toBe("Le responderemos dentro de {plazo}.");
  });

  it("sin fila de reglas: vacío", async () => {
    dbActual.db = dbGrabadora(() => []).db;
    expect(await leerMensajeConfirmacion()).toBe("");
  });

  it("WhatsApp: null sin sucursal, sin consultar; el de la sucursal si existe; null si la lectura falla", async () => {
    const g = dbGrabadora(() => [["  +54 9 11 5555-0100 "]]);
    dbActual.db = g.db;
    expect(await leerWhatsappSucursal(null)).toBeNull();
    expect(g.consultas).toHaveLength(0);
    expect(await leerWhatsappSucursal("igz")).toBe("+54 9 11 5555-0100");
    expect(g.consultas[0].sql).toContain('"public"."sucursales"');
    expect(g.consultas[0].params).toEqual(expect.arrayContaining(["tenant-ejemplo", "igz"]));

    dbActual.db = dbQueTira("boom");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await leerWhatsappSucursal("igz")).toBeNull();
    err.mockRestore();
  });
});

describe("listas por forma de pago (migración 0076 del CRM)", () => {
  const MP = ["mercadopago", "Mercado Pago", "", true, true, true, true, 0, false, false, "publico"];
  const L_TODAS = "00000000-0000-4000-8000-0000000000a1";
  const L_DEBITO = "00000000-0000-4000-8000-0000000000b2";
  const L_CREDITO = "00000000-0000-4000-8000-0000000000c3";
  const ID_TODAS = "id-todas";
  const ID_DEBITO = "id-debito";
  const ID_RARA = "id-rara";
  // [medioSlug, listaId, cuotas, montoMinimo, id]
  const condiciones = [
    ["mercadopago", L_TODAS, null, null, ID_TODAS],
    ["mercadopago", L_DEBITO, null, null, ID_DEBITO],
    ["mercadopago", L_CREDITO, null, null, ID_RARA],
  ];
  const conFormas = (formas: (c: { sql: string }) => unknown[][]) =>
    dbGrabadora((c) =>
      c.sql.includes('"forma"')
        ? formas(c)
        : c.sql.includes("lista_precio_condiciones")
          ? condiciones
          : c.sql.includes("opciones_cobro")
            ? []
            : [MP],
    );

  it("una fila con forma no pisa la lista del medio y va a listasPorForma; las desconocidas se ignoran", async () => {
    const g = conFormas(() => [
      [ID_DEBITO, "mercadopago", L_DEBITO, "debito"],
      [ID_RARA, "mercadopago", L_CREDITO, "efectivo"],
    ]);
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.idListaPrecios).toBe(L_TODAS);
    expect(mp.listasPorForma).toEqual({ debito: L_DEBITO });
    const consulta = g.consultas.find((c) => c.sql.includes('"forma"'))!;
    expect(consulta.sql).toContain('"public"."lista_precio_condiciones"');
    expect(consulta.sql).toContain('"forma" is not null');
    expect(consulta.params).toContain("tenant-ejemplo");
  });

  it("con filas por forma y sin fila de todas las formas, el medio queda sin lista propia", async () => {
    const g = dbGrabadora((c) =>
      c.sql.includes('"forma"')
        ? [[ID_DEBITO, "mercadopago", L_DEBITO, "debito"]]
        : c.sql.includes("lista_precio_condiciones")
          ? [["mercadopago", L_DEBITO, null, null, ID_DEBITO]]
          : c.sql.includes("opciones_cobro")
            ? []
            : [MP],
    );
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp.idListaPrecios).toBeNull();
    expect(mp.listasPorForma).toEqual({ debito: L_DEBITO });
  });

  it("columna ausente (42703): idéntico a antes, sin listasPorForma", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = conFormas(() => {
      throw Object.assign(new Error('column "forma" does not exist'), { code: "42703" });
    });
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp).not.toHaveProperty("listasPorForma");
    expect(mp.idListaPrecios).toBe(L_CREDITO) // sin la columna cada fila de pago único pisa a la anterior: gana la última, como siempre;
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("sin filas por forma, el medio no trae listasPorForma", async () => {
    const g = conFormas(() => []);
    const [mp] = await leerMediosPago(g.db as never);
    expect(mp).not.toHaveProperty("listasPorForma");
  });

});
