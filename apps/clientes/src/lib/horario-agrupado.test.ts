import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/horario-casos.json";
import {
  horarioAgrupado,
  horarioParaMostrar,
  hoyBuenosAires,
  normalizarExcepciones,
  normalizarSchedule,
  proximasExcepciones,
  tieneHorario,
} from "./horario-agrupado";

describe("horarioAgrupado", () => {
  for (const c of casos.agrupado) {
    it(c.nombre, () => {
      expect(horarioAgrupado(normalizarSchedule(c.schedule))).toBe(c.esperado);
    });
  }
});

describe("proximasExcepciones", () => {
  const { hoy, entrada, esperado } = casos.excepciones;
  const ex = normalizarExcepciones(entrada);

  it("oculta vencidas y lejanas, ordena y corta en 3", () => {
    expect(proximasExcepciones(ex, hoy)).toEqual(esperado);
  });

  it("respeta el máximo configurable", () => {
    expect(proximasExcepciones(ex, hoy, { max: 10 })).toHaveLength(
      casos.excepciones.esperadoSinMaximo,
    );
  });

  it("un rango en curso sigue visible", () => {
    expect(proximasExcepciones(ex, "2026-10-25")[0]).toBe("Cerrado del 20/10 al 30/10");
  });

  it("descarta entradas inválidas al normalizar", () => {
    expect(normalizarExcepciones([{ type: "closed", date: "mañana" }, null, "x"])).toEqual([]);
    expect(normalizarExcepciones("nada")).toEqual([]);
  });
});

describe("horarioParaMostrar / tieneHorario", () => {
  const semana = normalizarSchedule({ monday: [{ open: "09:00", close: "18:00" }] });

  it("con horario estructurado usa el agrupado y las excepciones", () => {
    const r = horarioParaMostrar(
      {
        schedule: semana,
        horario: "texto viejo",
        excepciones: normalizarExcepciones(casos.excepciones.entrada),
      },
      casos.excepciones.hoy,
    );
    expect(r.semanal).toContain("Lunes 9:00 a 18:00");
    expect(r.excepciones).toHaveLength(3);
  });

  it("sin schedule cae al texto legado", () => {
    expect(
      horarioParaMostrar(
        { schedule: normalizarSchedule({}), horario: "Lun a Vie 9 a 18" },
        "2026-10-01",
      ),
    ).toEqual({ semanal: "Lun a Vie 9 a 18", excepciones: [] });
  });

  it("sin nada no muestra horario", () => {
    const l = { schedule: normalizarSchedule({}), horario: "  " };
    expect(horarioParaMostrar(l, "2026-10-01")).toEqual({ semanal: null, excepciones: [] });
    expect(tieneHorario(l)).toBe(false);
    expect(tieneHorario({ schedule: semana })).toBe(true);
    expect(tieneHorario({ horario: "x" })).toBe(true);
  });
});

describe("hoyBuenosAires", () => {
  it("usa la fecha de Buenos Aires, no la UTC", () => {
    expect(hoyBuenosAires(new Date("2026-10-02T01:30:00Z"))).toBe("2026-10-01");
    expect(hoyBuenosAires(new Date("2026-10-02T04:00:00Z"))).toBe("2026-10-02");
  });
});
