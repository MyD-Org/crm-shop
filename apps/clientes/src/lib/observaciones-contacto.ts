/**
 * Email alternativo en las observaciones de un contacto de Alegra: lógica PURA.
 *
 * Vive aparte de `vinculacion.ts` para que la usen, sin importarse entre sí,
 * la vinculación y `contacto-write-through.ts` (la subida en segundo plano que
 * junta observaciones y datos de facturación en UN solo PUT).
 */

const ZONA_AR = "America/Argentina/Buenos_Aires";

export function normalizarEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Los emails de un contacto de Alegra, normalizados. El campo es un texto libre
 * y en la cuenta hay contactos con varios separados por coma, punto y coma o
 * espacio: mismo criterio que `emails_norm` del espejo del CRM.
 */
export function emailsDelContacto(email: unknown): string[] {
  if (typeof email !== "string") return [];
  return [
    ...new Set(
      email
        .toLowerCase()
        .split(/[,; ]+/)
        .map((e) => e.trim())
        .filter(Boolean),
    ),
  ];
}

/** DD/MM/AAAA en hora de Argentina (a las 22 h de Buenos Aires ya es otro día en UTC). */
export function fechaArgentina(fecha: Date): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA_AR,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(fecha);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")}/${parte("month")}/${parte("year")}`;
}

/** La línea que se agrega a las observaciones. */
export function lineaEmailAlternativo(email: string, fecha: Date): string {
  return `Tienda online: también usa ${email} (vinculado el ${fechaArgentina(fecha)})`;
}

/**
 * Las observaciones con la línea agregada al final, o `null` si no hay nada que
 * hacer: el email ya es del contacto, o ya figura en las observaciones (se
 * vinculó antes, o lo anotó a mano la sucursal). Eso lo hace idempotente.
 */
export function observacionesConEmail(
  observaciones: unknown,
  emailsContacto: unknown,
  email: string,
  fecha: Date,
): string | null {
  const norm = normalizarEmail(email);
  if (!norm || emailsDelContacto(emailsContacto).includes(norm)) return null;
  const actuales = typeof observaciones === "string" ? observaciones : "";
  if (actuales.toLowerCase().includes(norm)) return null;
  const linea = lineaEmailAlternativo(norm, fecha);
  return actuales.trim() ? `${actuales.trimEnd()}\n${linea}` : linea;
}
