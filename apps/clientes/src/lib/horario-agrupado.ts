/**
 * Horario estructurado de una sucursal (`public.sucursales.schedule` / `schedule_exceptions`,
 * migración 0051 del CRM) listo para MOSTRAR en "Ver local". Funciones puras: la fecha de hoy entra
 * por parámetro. La forma de los datos es la de `apps/admin/src/lib/schedule.ts`; la normalización
 * se duplica a propósito (no hay packages compartidos) y los casos están en
 * `__fixtures__/horario-casos.json`.
 */

export interface Franja {
  open: string;
  close: string;
}

export const DIAS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Dia = (typeof DIAS)[number];
export type HorarioSemanal = Record<Dia, Franja[]>;

export type ExcepcionHorario =
  | { type: "closed"; date: string; to: string | null; reason: string | null }
  | { type: "special"; date: string; ranges: Franja[]; reason: string | null };

const NOMBRE_DIA: Record<Dia, string> = {
  monday: "lunes",
  tuesday: "martes",
  wednesday: "miércoles",
  thursday: "jueves",
  friday: "viernes",
  saturday: "sábado",
  sunday: "domingo",
};

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(v: unknown): v is string {
  if (typeof v !== "string" || !FECHA_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function franjasValidas(raw: unknown): Franja[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (r): r is Franja =>
        !!r &&
        typeof r === "object" &&
        HORA_RE.test((r as Franja).open) &&
        HORA_RE.test((r as Franja).close) &&
        (r as Franja).close > (r as Franja).open,
    )
    .map((r) => ({ open: r.open, close: r.close }))
    .sort((a, b) => (a.open < b.open ? -1 : a.open > b.open ? 1 : 0));
}

/** Cualquier valor de la base -> semana con las 7 claves; descarta lo inválido. `{}` = sin configurar. */
export function normalizarSchedule(input: unknown): HorarioSemanal {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out = {} as HorarioSemanal;
  for (const d of DIAS) out[d] = franjasValidas(obj[d]);
  return out;
}

/** Cualquier valor de la base -> excepciones válidas; descarta cada entrada inválida. */
export function normalizarExcepciones(input: unknown): ExcepcionHorario[] {
  if (!Array.isArray(input)) return [];
  const out: ExcepcionHorario[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (!fechaValida(e.date)) continue;
    const reason = typeof e.reason === "string" && e.reason.trim() ? e.reason.trim() : null;
    if (e.type === "closed") {
      const to = fechaValida(e.to) && e.to >= e.date ? e.to : null;
      out.push({ type: "closed", date: e.date, to, reason });
    } else if (e.type === "special") {
      const ranges = franjasValidas(e.ranges);
      if (ranges.length === 0) continue;
      out.push({ type: "special", date: e.date, ranges, reason });
    }
  }
  return out;
}

/** "08:00" -> "8:00". */
function hora(h: string): string {
  return h.replace(/^0/, "");
}

function textoFranjas(franjas: Franja[]): string {
  return franjas.map((f) => `${hora(f.open)} a ${hora(f.close)}`).join(" y ");
}

function unir(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** Días de un grupo: tandas consecutivas de 3+ van "A a B"; de 2, "A y B". */
function textoDias(dias: Dia[]): string {
  const idx = dias.map((d) => DIAS.indexOf(d));
  const tandas: number[][] = [];
  for (const i of idx) {
    const ultima = tandas[tandas.length - 1];
    if (ultima && ultima[ultima.length - 1] === i - 1) ultima.push(i);
    else tandas.push([i]);
  }
  const partes = tandas.flatMap((t) => {
    const nombres = t.map((i) => NOMBRE_DIA[DIAS[i]]);
    if (nombres.length >= 3) return [`${nombres[0]} a ${nombres[nombres.length - 1]}`];
    return nombres;
  });
  const texto = unir(partes);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Semana -> "Lunes a viernes 8:00 a 12:00 y 14:00 a 18:00 · Sábado 9:00 a 13:00 · Domingo cerrado".
 * Agrupa los días con el mismo horario (consecutivos o no). Semana sin ninguna franja -> `null`
 * (cuenta como "sin horario estructurado").
 */
export function horarioAgrupado(semana: HorarioSemanal): string | null {
  if (DIAS.every((d) => semana[d].length === 0)) return null;
  const grupos = new Map<string, { dias: Dia[]; franjas: Franja[] }>();
  for (const d of DIAS) {
    const clave = JSON.stringify(semana[d]);
    const g = grupos.get(clave);
    if (g) g.dias.push(d);
    else grupos.set(clave, { dias: [d], franjas: semana[d] });
  }
  const todos = grupos.size === 1;
  return [...grupos.values()]
    .map((g) => {
      const cuando = todos ? "Todos los días" : textoDias(g.dias);
      return `${cuando} ${g.franjas.length ? textoFranjas(g.franjas) : "cerrado"}`;
    })
    .join(" · ");
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-12" -> "12/10". */
function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Excepciones vigentes o próximas, ya redactadas: fin >= `hoy` y comienzo dentro de los próximos
 * `dias` (30), por fecha, hasta `max` (3). Las pasadas se ocultan. `hoy` es "YYYY-MM-DD".
 */
export function proximasExcepciones(
  excepciones: ExcepcionHorario[],
  hoy: string,
  { dias = 30, max = 3 }: { dias?: number; max?: number } = {},
): string[] {
  // Sin fecha válida (p. ej. antes de abrir el popup, "hoy" todavía vacío) no hay nada que mostrar.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) return [];
  const limite = sumarDias(hoy, dias);
  return excepciones
    .filter((e) => {
      const fin = e.type === "closed" ? (e.to ?? e.date) : e.date;
      return fin >= hoy && e.date <= limite;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, max)
    .map((e) => {
      const motivo = e.reason ? ` (${e.reason})` : "";
      if (e.type === "closed") {
        return e.to && e.to !== e.date
          ? `Cerrado del ${diaMes(e.date)} al ${diaMes(e.to)}${motivo}`
          : `Cerrado el ${diaMes(e.date)}${motivo}`;
      }
      return `El ${diaMes(e.date)} abre de ${textoFranjas(e.ranges)}${motivo}`;
    });
}

/** Hoy en Buenos Aires como "YYYY-MM-DD". Llamar al mostrar (cliente), nunca en una caché. */
export function hoyBuenosAires(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

export interface HorarioLocal {
  schedule?: HorarioSemanal;
  excepciones?: ExcepcionHorario[];
  /** Texto libre legado (`sucursales.horario`). */
  horario?: string;
}

/** ¿Hay algo de horario para mostrar (estructurado o texto legado)? */
export function tieneHorario(l: HorarioLocal): boolean {
  return Boolean(l.horario?.trim()) || (l.schedule ? horarioAgrupado(l.schedule) !== null : false);
}

export interface HorarioParaMostrar {
  /** Semana agrupada, o el texto legado si la sucursal no tiene horario estructurado; null = nada. */
  semanal: string | null;
  /** Las próximas excepciones (sólo con horario estructurado). */
  excepciones: string[];
}

export function horarioParaMostrar(l: HorarioLocal, hoy: string): HorarioParaMostrar {
  const agrupado = l.schedule ? horarioAgrupado(l.schedule) : null;
  if (agrupado) {
    return { semanal: agrupado, excepciones: proximasExcepciones(l.excepciones ?? [], hoy) };
  }
  const legado = l.horario?.trim();
  return { semanal: legado ? l.horario! : null, excepciones: [] };
}
