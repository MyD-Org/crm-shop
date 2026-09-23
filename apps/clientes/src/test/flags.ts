/**
 * Flags de Vercel Flags en los tests. `src/flags.ts` evalúa contra Vercel en
 * tiempo de request, así que en vitest se reemplaza entero (ver setup-flags.ts)
 * por lecturas de este estado. Arranca todo apagado antes de cada test, igual
 * que el `defaultValue` de producción.
 *
 * El estado vive en `globalThis` y no en una variable del módulo para que
 * sobreviva a `vi.resetModules()` (los tests que reimportan con `await import`).
 */
export type FlagDeTest = "pagos" | "cuotas" | "catalogo-solo-visibles";

type Estado = Record<FlagDeTest, boolean>;

const g = globalThis as typeof globalThis & { __flagsDeTest?: Estado };

export function estadoFlags(): Estado {
  g.__flagsDeTest ??= apagados();
  return g.__flagsDeTest;
}

export function apagados(): Estado {
  return { pagos: false, cuotas: false, "catalogo-solo-visibles": false };
}

export function setFlag(flag: FlagDeTest, valor: boolean) {
  estadoFlags()[flag] = valor;
}

export function reiniciarFlags() {
  g.__flagsDeTest = apagados();
}
