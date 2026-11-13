import { describe, expect, it } from "vitest";
import type { SugerenciaLocalidad } from "./georef";
import { priorizarLocalidades, type LocalAtendida } from "./localidades-busqueda";

const g = (id: string, localidad: string, provincia = "buenosaires", provinciaNombre = "Buenos Aires"): SugerenciaLocalidad => ({
  id,
  localidad,
  provincia,
  provinciaNombre,
});
const mdp: LocalAtendida = { id: "1", nombre: "Mar del Plata", provincia: "buenosaires", provinciaNombre: "Buenos Aires", abreviaturas: ["mdp"] };

describe("priorizarLocalidades", () => {
  it('"mar del": Mar del Plata primero y con el id del local', () => {
    const r = priorizarLocalidades("mar del", [g("9", "Mar del Tuyú"), g("1", "Mar del Plata"), g("8", "Villa del Mar", "cordoba", "Córdoba")], [mdp]);
    expect(r[0]).toEqual({ id: "1", etiqueta: "Mar del Plata — Buenos Aires" });
    expect(r.map((o) => o.id)).toEqual(["1", "9", "8"]);
  });

  it('"mdp" encuentra Mar del Plata por abreviatura aunque tenga menos de 4 caracteres', () => {
    expect(priorizarLocalidades("MDP", [], [mdp])).toEqual([{ id: "1", etiqueta: "Mar del Plata — Buenos Aires" }]);
  });

  it("un texto corto que no es abreviatura no devuelve locales", () => {
    expect(priorizarLocalidades("mar", [], [mdp])).toEqual([]);
  });

  it("prefijo de palabra: «plata» encuentra Mar del Plata, por detrás del prefijo del nombre", () => {
    const otra: LocalAtendida = { id: "2", nombre: "Plataforma", provincia: "buenosaires", provinciaNombre: "Buenos Aires", abreviaturas: [] };
    const r = priorizarLocalidades("plat", [], [mdp, otra]);
    expect(r.map((o) => o.id)).toEqual(["2", "1"]);
  });

  it("dedupe por provincia + nombre: el local gana y conserva su id; el homónimo de otra provincia se mantiene", () => {
    const r = priorizarLocalidades("mar del plata", [g("77", "Mar del Plata"), g("78", "Mar del Plata", "cordoba", "Córdoba")], [mdp]);
    expect(r.map((o) => o.id)).toEqual(["1", "78"]);
  });

  it("un local sin id sólo sube la posición de la coincidencia de Georef", () => {
    const sinId: LocalAtendida = { ...mdp, id: undefined };
    const r = priorizarLocalidades("mar del", [g("9", "Mar del Tuyú"), g("1", "Mar del Plata")], [sinId]);
    expect(r[0].id).toBe("1");
    expect(priorizarLocalidades("mdp", [], [sinId])).toEqual([]);
  });

  it("orden: local > Georef por prefijo > resto; tope 8", () => {
    const muchos = Array.from({ length: 12 }, (_, i) => g(String(100 + i), `Marina ${i}`));
    expect(priorizarLocalidades("mari", muchos, [])).toHaveLength(8);
    const r = priorizarLocalidades("del pl", [g("5", "Del Plomo"), g("6", "Valle del Plomo")], [mdp]);
    expect(r.map((o) => o.id)).toEqual(["1", "5", "6"]);
  });

  it("sin locales respeta el orden de Georef", () => {
    const r = priorizarLocalidades("pueb", [g("1", "Puerto"), g("2", "Pueblo")], []);
    expect(r.map((o) => o.id)).toEqual(["2", "1"]);
  });
});
