/**
 * Nombre con el que se exhibe un producto: el mismo en el catálogo, la ficha,
 * el carrito y la cotización (checkout y pedido).
 *
 * Orden: el curado en el CRM; si no, el `name` de Alegra. La descripción de
 * Alegra sólo reemplaza al `name` cuando el `name` es el código (la referencia,
 * o la referencia sin el sufijo de marca): en esta cuenta el `name` trae el
 * nombre y la descripción las características. Un texto vacío no pisa (`||` en
 * TS, `nullif` en SQL). Es la misma regla que `nombreEfectivo` del CRM.
 */
import { and, eq, sql } from "drizzle-orm";
import { crmCatalogo, crmOverlay } from "@/db/crm";
import { shopTenantId } from "./tenant";

export function nameEsCodigo(fila: { name: string; code: string | null }): boolean {
  const name = fila.name?.trim().toUpperCase();
  const code = fila.code?.trim().toUpperCase();
  return !!name && !!code && (code === name || code.startsWith(`${name}-`));
}

/**
 * Flag `variantes-selector`: el nombre del modelo cuando la fila es una variante de Alegra de un grupo
 * y el ancla no tiene nombre curado. El `name` de la variante termina en " / " + etiqueta ("Optic 3 /
 * Blanco cálido"): sin ese sufijo queda el nombre del padre. Sólo `tipo = 'variante'`: en un grupo
 * manual no hay nombre de padre (la usuaria lo pone en el admin) y el `name` se deja como está.
 * `undefined` = no aplica. Misma regla que `nombreExhibidoSql`.
 */
function nombreSinOpcion(fila: {
  overlayNombre: string | null;
  name: string;
  tipo?: string | null;
  grupoId?: string | null;
  etiqueta?: string | null;
}): string | undefined {
  if (fila.overlayNombre?.trim() || !fila.grupoId || fila.tipo !== "variante") return undefined;
  const etiqueta = fila.etiqueta?.trim();
  const nombre = fila.name?.trim();
  if (!etiqueta || !nombre) return undefined;
  const sufijo = ` / ${etiqueta}`;
  if (nombre.length <= sufijo.length || nombre.slice(-sufijo.length).toLowerCase() !== sufijo.toLowerCase()) {
    return undefined;
  }
  return nombre.slice(0, -sufijo.length).trim() || undefined;
}

export function nombreExhibido(fila: {
  overlayNombre: string | null;
  description: string | null;
  name: string;
  code: string | null;
  /** Sólo con `agrupar` (flag `variantes-selector`): ver `nombreSinOpcion`. */
  tipo?: string | null;
  grupoId?: string | null;
  etiqueta?: string | null;
}): string {
  return (
    fila.overlayNombre?.trim() ||
    nombreSinOpcion(fila) ||
    (nameEsCodigo(fila) ? fila.description?.trim() : "") ||
    fila.name
  );
}

/** Normaliza para comparar: recorta, colapsa espacios y es case-insensitive. */
const normalizado = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * La descripción tal como se le muestra al visitante: `undefined` si no hay
 * dato, o si es el mismo texto que el nombre exhibido (pasa cuando
 * `nombreExhibido` ya tomó la descripción de Alegra como nombre, `nameEsCodigo`,
 * pero también con productos que por otra razón repiten el mismo texto en los
 * dos campos). Mostrarla ahí sería repetir el título.
 *
 * La descripción curada en el CRM (`overlayDescripcion`) gana siempre: alguien la escribió para la
 * tienda. Vacía no pisa, igual que el nombre curado.
 */
export function descripcionExhibida(fila: {
  overlayNombre: string | null;
  overlayDescripcion?: string | null;
  description: string | null;
  name: string;
  code: string | null;
}): string | undefined {
  const curada = fila.overlayDescripcion?.trim();
  if (curada) return curada;
  const descripcion = fila.description?.trim();
  if (!descripcion) return undefined;
  return normalizado(descripcion) === normalizado(nombreExhibido(fila)) ? undefined : descripcion;
}

/**
 * `nombreExhibido` en SQL, para consultas con base en la vista del CRM
 * (`crmCatalogo`) que ya traen el overlay (`joinOverlay`).
 */
export const nombreExhibidoSql = sql<string>`coalesce(
  nullif(btrim(${crmOverlay.nombre}), ''),
  CASE WHEN nullif(btrim(${crmCatalogo.name}), '') IS NOT NULL AND (
    upper(btrim(${crmCatalogo.code})) = upper(btrim(${crmCatalogo.name}))
    OR starts_with(upper(btrim(${crmCatalogo.code})), upper(btrim(${crmCatalogo.name})) || '-')
  ) THEN nullif(btrim(${crmCatalogo.description}), '') END,
  ${crmCatalogo.name}
)`;

/**
 * `nombreExhibidoSql` con el flag `variantes-selector` (ver `nombreSinOpcion`): para las consultas que
 * arman el nombre de una línea (la cotización le suma la opción después, con `nombreConOpcion`). La
 * búsqueda y el orden siguen usando `nombreExhibidoSql`: encontrar "Blanco cálido" por el nombre de la
 * variante es lo que se quiere.
 */
export const nombreExhibidoAgrupadoSql = sql<string>`(CASE WHEN nullif(btrim(${crmOverlay.nombre}), '') IS NULL
    AND ${crmCatalogo.grupoId} IS NOT NULL
    AND ${crmCatalogo.tipo} = 'variante'
    AND nullif(btrim(${crmCatalogo.etiqueta}), '') IS NOT NULL
    AND length(btrim(${crmCatalogo.name})) > length(' / ' || btrim(${crmCatalogo.etiqueta}))
    AND lower(right(btrim(${crmCatalogo.name}), length(' / ' || btrim(${crmCatalogo.etiqueta}))))
        = lower(' / ' || btrim(${crmCatalogo.etiqueta}))
  THEN btrim(left(btrim(${crmCatalogo.name}), length(btrim(${crmCatalogo.name})) - length(' / ' || btrim(${crmCatalogo.etiqueta}))))
  ELSE ${nombreExhibidoSql} END)`;

/**
 * Join al overlay del CRM (puede no tener fila). La tabla es de todos los
 * tenants del CRM: el tenant va en el join, no en el WHERE, para no convertirlo
 * en un inner join. Función y no constante: el tenant se lee del entorno en
 * cada consulta.
 *
 * `agrupar` es el flag `variantes-selector` (change `variantes-de-producto`):
 * apagado, el overlay es el del propio producto (como siempre); prendido, es el
 * del ANCLA del grupo (`overlay_alegra_id` de la vista: el padre de Alegra, la
 * base de un grupo manual, o el propio producto si se vende suelto). Es
 * obligatorio a propósito: un call site que lo olvide no compila.
 */
export const joinOverlay = (agrupar: boolean) =>
  and(
    eq(crmOverlay.alegraId, agrupar ? crmCatalogo.overlayAlegraId : crmCatalogo.alegraId),
    eq(crmOverlay.tenantId, shopTenantId()),
  );
