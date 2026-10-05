/**
 * Rutas de salida de los scripts de medición (repo público): los archivos con
 * consultas reales o resultados por caso nunca deben quedar a un `git add` de
 * distancia. `rutaIgnoradaPorGit` pregunta a git; `resolverSalida` aborta
 * (modo estricto: lo usa la extracción de consultas) o avisa (modo laxo: el
 * banco y la cobertura, que sólo escriben agregados) si la ruta no está ignorada.
 */
import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

export interface DepsGit {
  /** Raíz del repo (`git rev-parse --show-toplevel`). */
  raiz(): string;
  /** `git check-ignore -q <ruta>`: true si git la ignora. */
  ignorada(rutaAbsoluta: string): boolean;
}

export const depsGitReales: DepsGit = {
  raiz: () => execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
  ignorada: (ruta) => {
    try {
      execFileSync("git", ["check-ignore", "-q", ruta], { stdio: "ignore" });
      return true;
    } catch {
      // Salida 1 = no ignorada; cualquier otro fallo (git ausente) también cuenta como "no ignorada".
      return false;
    }
  },
};

/** ¿La ruta es segura para datos locales? Fuera del repo, o dentro y ignorada por git. */
export function rutaIgnoradaPorGit(ruta: string, deps: DepsGit = depsGitReales, cwd: string = process.cwd()): boolean {
  const absoluta = resolve(cwd, ruta);
  const rel = relative(deps.raiz(), absoluta);
  if (rel.startsWith("..") || isAbsolute(rel)) return true;
  return deps.ignorada(absoluta);
}

export interface SalidaResuelta {
  ruta: string;
  advertencia?: string;
}

/**
 * Resuelve la ruta de salida. `estricto`: una ruta del repo que git no ignora
 * lanza error (el que llama sale con código != 0). Laxo: sólo devuelve la advertencia.
 */
export function resolverSalida(
  ruta: string,
  { estricto }: { estricto: boolean },
  deps: DepsGit = depsGitReales,
  cwd: string = process.cwd(),
): SalidaResuelta {
  const absoluta = resolve(cwd, ruta);
  if (rutaIgnoradaPorGit(absoluta, deps, cwd)) return { ruta: absoluta };
  const aviso = `la ruta ${absoluta} no está ignorada por git: podría commitearse por accidente (repo público)`;
  if (estricto) throw new Error(`Salida rechazada: ${aviso}. Use una ruta bajo tmp/ o fuera del repo.`);
  return { ruta: absoluta, advertencia: `[aviso] ${aviso}` };
}
