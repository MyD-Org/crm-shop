import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JEV_MODELO,
  JEV_URL,
  PREGUNTA_TONO,
  consultarJev,
  estadoJev,
  nivelDe,
  opcionesDeCategorias,
  type PreguntaChoice,
} from "./jev";
import type { NodoArbol } from "./tipos";

const preguntas: Record<string, PreguntaChoice> = { tono: PREGUNTA_TONO };
const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("semáforo", () => {
  it("≥ 0,9 aplica, 0,7–0,9 sugiere, menos nada", () => {
    expect(nivelDe(0.95)).toBe("aplicar");
    expect(nivelDe(0.9)).toBe("aplicar");
    expect(nivelDe(0.89)).toBe("sugerir");
    expect(nivelDe(0.7)).toBe("sugerir");
    expect(nivelDe(0.69)).toBeNull();
  });
});

describe("consultarJev", () => {
  it("manda modelo pineado, state con la consulta y preguntas por id; lee la respuesta", async () => {
    const fetch = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
      respuesta({
        answers: { tono: { type: "choice", choice: "calido", confidence: 0.97, probabilities: { calido: 0.97 } } },
        usage: { tokens: 800 },
      }),
    );
    const r = await consultarJev("luz calida", preguntas, { apiKey: "clave-de-prueba", fetch: fetch as typeof globalThis.fetch });
    expect(r).toEqual({ tono: { choice: "calido", confidence: 0.97 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(JEV_URL);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer clave-de-prueba");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ model: JEV_MODELO, state: estadoJev("luz calida"), questions: preguntas });
    expect(body.state).toContain('"luz calida"');
  });

  it("sin key no llama", async () => {
    vi.stubEnv("JEV_API_KEY", "");
    const fetch = vi.fn();
    expect(await consultarJev("x", preguntas, { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("error HTTP ⇒ null, sin reintentos y sin loguear la consulta", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => respuesta({ error: "x" }, 500));
    expect(await consultarJev("consulta privada", preguntas, { apiKey: "k", fetch })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain("consulta privada");
  });

  it("timeout ⇒ null (aborta con la señal)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
        }),
    );
    const antes = Date.now();
    expect(await consultarJev("x", preguntas, { apiKey: "k", fetch: fetch as typeof globalThis.fetch, timeoutMs: 20 })).toBeNull();
    expect(Date.now() - antes).toBeLessThan(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("descarta respuestas con opciones inventadas, confianza fuera de rango o de otro tipo", async () => {
    const fetch = vi.fn(async () =>
      respuesta({
        answers: {
          tono: { type: "choice", choice: "violeta", confidence: 0.99 },
          otra: { type: "choice", choice: "calido", confidence: 0.99 },
        },
      }),
    );
    expect(await consultarJev("x", preguntas, { apiKey: "k", fetch })).toEqual({});
    const fetch2 = vi.fn(async () => respuesta({ answers: { tono: { type: "noul", choice: "calido", confidence: 2 } } }));
    expect(await consultarJev("x", preguntas, { apiKey: "k", fetch: fetch2 })).toEqual({});
  });

  it("JSON roto ⇒ null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response("no es json", { status: 200 }));
    expect(await consultarJev("x", preguntas, { apiKey: "k", fetch })).toBeNull();
  });
});

describe("opcionesDeCategorias", () => {
  const n = (id: string, nombre: string, parentId: string | null = null, orden = 0): NodoArbol => ({ id, parentId, nombre, orden });
  const arbol = [n("r1", "ILUMINACIÓN", null, 1), n("r2", "Herramientas", null, 2), n("h1", "Reflectores", "r1", 1), n("h2", "Tiras LED", "r1", 2)];

  it("clave legible por nombre y descripción con las subcategorías", () => {
    const { criteria, porClave } = opcionesDeCategorias([arbol[0], arbol[1]], arbol);
    expect(criteria).toEqual({ iluminacion: "ILUMINACIÓN: Reflectores, Tiras LED", herramientas: "Herramientas" });
    expect(porClave.get("iluminacion")?.id).toBe("r1");
  });

  it("nombres repetidos no se pisan", () => {
    const { porClave } = opcionesDeCategorias([n("a", "Varios"), n("b", "Varios")], []);
    expect([...porClave.keys()]).toEqual(["varios", "varios_2"]);
  });
});
