/**
 * Validación de los dos payloads que el CRM sirve (contrato catalogo-overlay/v1).
 *
 * PURO: recibe `unknown` y devuelve el tipo o un error. Sin DB ni red, para poder probarlo con
 * los fixtures del contrato.
 *
 * Se valida TODO lo que entra, aunque venga de un sistema propio: un CRM a medio desplegar puede
 * mandar una forma vieja, y guardar eso rompería la tienda en silencio. Ante algo inválido se
 * descarta la respuesta entera y se conserva la última copia buena.
 *
 * Contrato: MyD-Org/platform/contracts/catalogo-overlay/v1.
 */

export const VERSION_CONTRATO = "v1";

export interface CategoriaContrato {
  id: string;
  parentId: string | null;
  nombre: string;
  slug: string;
  orden: number;
  nivel: number;
  activa: boolean;
  imagen: string | null;
}

export interface TagContrato {
  id: string;
  nombre: string;
  slug: string;
}

export interface ContratoTaxonomia {
  version: string;
  tenant: string;
  actualizadoEn: string;
  categorias: CategoriaContrato[];
  tags: TagContrato[];
}

export interface FotoContrato {
  url: string;
  w: number;
  alt?: string;
}

export interface ItemOverlay {
  alegraId: string;
  visible: boolean;
  nombre: string | null;
  descripcion: string | null;
  categoriaId: string | null;
  orden: number | null;
  tagIds: string[];
  fotos: FotoContrato[];
  updatedAt: string;
}

export interface ContratoOverlay {
  version: string;
  tenant: string;
  items: ItemOverlay[];
  nextCursor: { desde: string; cursor: string } | null;
  hasMore: boolean;
}

export class ContratoInvalido extends Error {}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function texto(v: unknown, campo: string): string {
  if (typeof v !== "string" || v === "") throw new ContratoInvalido(`${campo}: se esperaba texto`);
  return v;
}

function textoONull(v: unknown, campo: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new ContratoInvalido(`${campo}: se esperaba texto o null`);
  return v;
}

function entero(v: unknown, campo: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ContratoInvalido(`${campo}: se esperaba entero`);
  return v;
}

function booleano(v: unknown, campo: string): boolean {
  if (typeof v !== "boolean") throw new ContratoInvalido(`${campo}: se esperaba booleano`);
  return v;
}

function lista(v: unknown, campo: string): unknown[] {
  if (!Array.isArray(v)) throw new ContratoInvalido(`${campo}: se esperaba lista`);
  return v;
}

function verificarVersion(raiz: Record<string, unknown>): void {
  const version = texto(raiz.version, "version");
  // Una versión distinta NO se intenta interpretar: es exactamente el desfasaje que dejó el
  // contrato de cuotas roto en silencio (CRM sirviendo v1 contra un Shop que exigía v2).
  if (version !== VERSION_CONTRATO) {
    throw new ContratoInvalido(`version: se esperaba ${VERSION_CONTRATO} y llegó ${version}`);
  }
}

export function parsearTaxonomia(raw: unknown): ContratoTaxonomia {
  if (!esObjeto(raw)) throw new ContratoInvalido("la respuesta no es un objeto");
  verificarVersion(raw);

  const categorias = lista(raw.categorias, "categorias").map((c, i) => {
    if (!esObjeto(c)) throw new ContratoInvalido(`categorias[${i}]: no es un objeto`);
    return {
      id: texto(c.id, `categorias[${i}].id`),
      parentId: textoONull(c.parentId, `categorias[${i}].parentId`),
      nombre: texto(c.nombre, `categorias[${i}].nombre`),
      slug: texto(c.slug, `categorias[${i}].slug`),
      orden: entero(c.orden, `categorias[${i}].orden`),
      nivel: entero(c.nivel, `categorias[${i}].nivel`),
      activa: booleano(c.activa, `categorias[${i}].activa`),
      imagen: textoONull(c.imagen, `categorias[${i}].imagen`),
    };
  });

  const tags = lista(raw.tags, "tags").map((t, i) => {
    if (!esObjeto(t)) throw new ContratoInvalido(`tags[${i}]: no es un objeto`);
    return {
      id: texto(t.id, `tags[${i}].id`),
      nombre: texto(t.nombre, `tags[${i}].nombre`),
      slug: texto(t.slug, `tags[${i}].slug`),
    };
  });

  return {
    version: VERSION_CONTRATO,
    tenant: texto(raw.tenant, "tenant"),
    actualizadoEn: texto(raw.actualizadoEn, "actualizadoEn"),
    categorias,
    tags,
  };
}

export function parsearOverlay(raw: unknown): ContratoOverlay {
  if (!esObjeto(raw)) throw new ContratoInvalido("la respuesta no es un objeto");
  verificarVersion(raw);

  const items = lista(raw.items, "items").map((it, i) => {
    if (!esObjeto(it)) throw new ContratoInvalido(`items[${i}]: no es un objeto`);
    const fotos = lista(it.fotos ?? [], `items[${i}].fotos`).map((f, j) => {
      if (!esObjeto(f)) throw new ContratoInvalido(`items[${i}].fotos[${j}]: no es un objeto`);
      const alt = textoONull(f.alt, `items[${i}].fotos[${j}].alt`);
      return { url: texto(f.url, `items[${i}].fotos[${j}].url`), w: entero(f.w, `items[${i}].fotos[${j}].w`), ...(alt ? { alt } : {}) };
    });
    return {
      alegraId: texto(it.alegraId, `items[${i}].alegraId`),
      visible: booleano(it.visible, `items[${i}].visible`),
      nombre: textoONull(it.nombre, `items[${i}].nombre`),
      descripcion: textoONull(it.descripcion, `items[${i}].descripcion`),
      categoriaId: textoONull(it.categoriaId, `items[${i}].categoriaId`),
      orden: it.orden === null || it.orden === undefined ? null : entero(it.orden, `items[${i}].orden`),
      tagIds: lista(it.tagIds ?? [], `items[${i}].tagIds`).map((t, j) => texto(t, `items[${i}].tagIds[${j}]`)),
      fotos,
      updatedAt: texto(it.updatedAt, `items[${i}].updatedAt`),
    };
  });

  const nc = raw.nextCursor;
  const nextCursor =
    nc === null || nc === undefined
      ? null
      : esObjeto(nc)
        ? { desde: texto(nc.desde, "nextCursor.desde"), cursor: texto(nc.cursor, "nextCursor.cursor") }
        : (() => {
            throw new ContratoInvalido("nextCursor: no es un objeto");
          })();

  return {
    version: VERSION_CONTRATO,
    tenant: texto(raw.tenant, "tenant"),
    items,
    nextCursor,
    hasMore: booleano(raw.hasMore, "hasMore"),
  };
}
