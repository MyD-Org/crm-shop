import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REDIS_TIMEOUT_MS, permitir, permitirAsync } from "./rate-limit";

/**
 * El rate limit es lo único que hoy frena tres cosas: la enumeración de CUITs,
 * el barrido de `/api/geocode` que haría banear la IP del servidor contra
 * Nominatim, y la amplificación de `/api/carrito/cotizar` contra Alegra.
 *
 * Las claves llevan un prefijo distinto por test porque el store vive en el
 * módulo y persiste entre tests dentro del mismo archivo.
 */

describe("permitir", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deja pasar hasta el máximo y corta después", () => {
    const clave = "tope:usuario";
    expect(permitir(clave, 3, 60_000)).toBe(true);
    expect(permitir(clave, 3, 60_000)).toBe(true);
    expect(permitir(clave, 3, 60_000)).toBe(true);
    expect(permitir(clave, 3, 60_000)).toBe(false);
    expect(permitir(clave, 3, 60_000)).toBe(false);
  });

  it("no consume usos cuando ya cortó", () => {
    const clave = "sin-consumo:usuario";
    permitir(clave, 1, 60_000);
    permitir(clave, 1, 60_000);
    permitir(clave, 1, 60_000);

    // Vencida la ventana debe volver a permitir el máximo completo: los
    // rechazos no pueden haber empujado el contador más allá del tope.
    vi.advanceTimersByTime(60_001);
    expect(permitir(clave, 1, 60_000)).toBe(true);
  });

  it("reabre la ventana cuando vence", () => {
    const clave = "ventana:usuario";
    expect(permitir(clave, 2, 60_000)).toBe(true);
    expect(permitir(clave, 2, 60_000)).toBe(true);
    expect(permitir(clave, 2, 60_000)).toBe(false);

    vi.advanceTimersByTime(59_000);
    expect(permitir(clave, 2, 60_000), "todavía dentro de la ventana").toBe(false);

    vi.advanceTimersByTime(2_000);
    expect(permitir(clave, 2, 60_000), "ventana vencida").toBe(true);
  });

  it("cuenta cada clave por separado", () => {
    expect(permitir("aislado:a", 1, 60_000)).toBe(true);
    expect(permitir("aislado:a", 1, 60_000)).toBe(false);
    // Otro usuario no puede quedar afectado por el tope del primero.
    expect(permitir("aislado:b", 1, 60_000)).toBe(true);
  });

  /**
   * Con máximo 0 no pasa nadie. Sin el chequeo explícito, la rama de "ventana
   * nueva" devuelve `true` antes de mirar el máximo y el primer request se
   * cuela — que es justo el que no debería pasar si alguien configura 0 para
   * apagar un endpoint.
   */
  it("con máximo 0 o negativo no deja pasar ni el primero", () => {
    expect(permitir("cero:usuario", 0, 60_000)).toBe(false);
    expect(permitir("negativo:usuario", -1, 60_000)).toBe(false);
  });
});

/**
 * `permitirAsync` habla con la REST API de Upstash por `fetch`. Acá `fetch` es
 * un mock: lo que se prueba es el contrato (qué manda, cómo lee la respuesta)
 * y, sobre todo, que ante CUALQUIER problema cae al contador en memoria en vez
 * de bloquear o de lanzar.
 */
describe("permitirAsync", () => {
  const URL_REDIS = "https://redis.example";
  const TOKEN = "token-de-prueba";
  const fetchMock = vi.fn<typeof fetch>();

  /** Respuesta del pipeline de Upstash: `[{result: INCR}, {result: PEXPIRE}]`. */
  const respuestaPipeline = (usos: number) =>
    new Response(JSON.stringify([{ result: usos }, { result: 1 }]), { status: 200 });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", URL_REDIS);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", TOKEN);
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("cuenta en Redis con INCR + PEXPIRE en un pipeline y respeta el tope", async () => {
    fetchMock
      .mockResolvedValueOnce(respuestaPipeline(1))
      .mockResolvedValueOnce(respuestaPipeline(2))
      .mockResolvedValueOnce(respuestaPipeline(3));

    expect(await permitirAsync("redis:tope", 2, 60_000)).toBe(true);
    expect(await permitirAsync("redis:tope", 2, 60_000)).toBe(true);
    expect(await permitirAsync("redis:tope", 2, 60_000)).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${URL_REDIS}/pipeline`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const cuerpo = JSON.parse(String(init?.body)) as string[][];
    const ventana = Math.floor(Date.now() / 60_000);
    expect(cuerpo).toEqual([
      ["INCR", `rl:redis:tope:${ventana}`],
      ["PEXPIRE", `rl:redis:tope:${ventana}`, "60000"],
    ]);
  });

  it("acepta las variables KV_REST_API_* como alternativa, sin mezclar pares", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://kv.example/");
    vi.stubEnv("KV_REST_API_TOKEN", "token-kv");
    fetchMock.mockResolvedValueOnce(respuestaPipeline(1));

    expect(await permitirAsync("redis:kv", 1, 60_000)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://kv.example/pipeline");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-kv");
  });

  it("sin credenciales no toca la red y cuenta en memoria", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    expect(await permitirAsync("memoria:sin-cred", 1, 60_000)).toBe(true);
    expect(await permitirAsync("memoria:sin-cred", 1, 60_000)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con máximo 0 no deja pasar ni consulta a Redis", async () => {
    expect(await permitirAsync("redis:cero", 0, 60_000)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ante un error de red cae al contador en memoria (fail-open al local)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    expect(await permitirAsync("memoria:red", 1, 60_000)).toBe(true);
    expect(await permitirAsync("memoria:red", 1, 60_000)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ante un HTTP no-2xx o una respuesta inesperada cae a memoria", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ error: "WRONGTYPE" }, { result: 0 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    expect(await permitirAsync("memoria:http", 2, 60_000)).toBe(true);
    expect(await permitirAsync("memoria:http", 2, 60_000)).toBe(true);
    expect(await permitirAsync("memoria:http", 2, 60_000)).toBe(false);
  });

  it(`corta la espera a ${REDIS_TIMEOUT_MS} ms y cae a memoria`, async () => {
    // fetch "colgado": sólo termina cuando el AbortSignal del timeout dispara.
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    const inicio = Date.now();
    expect(await permitirAsync("memoria:timeout", 1, 60_000)).toBe(true);
    expect(await permitirAsync("memoria:timeout", 1, 60_000)).toBe(false);
    const tardo = Date.now() - inicio;
    expect(tardo).toBeGreaterThanOrEqual(REDIS_TIMEOUT_MS * 2 - 20);
    expect(tardo).toBeLessThan(REDIS_TIMEOUT_MS * 2 + 1_000);
  });
});
