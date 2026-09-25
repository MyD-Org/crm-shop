"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { esAdmin } from "@/lib/auth";
import { getCatalogo } from "@/lib/catalog";
import {
  KEY_LEGAL,
  KEY_OCULTAS,
  SECCIONES_HOME,
  VISIBILIDADES,
  combinarContenidoHome,
  erroresSeccion,
  resolverVisibilidad,
  validarDatosLegales,
  type SeccionHome,
} from "@/data/home-defaults";
import { borrarSeccionHome, guardarSeccionHome, leerSeccionHome } from "@/lib/home-guardar";
import { getShopMediaR2, homeImagenKey, urlPublicaHome } from "@/lib/shop-media";
import { shopTenantId } from "@/lib/tenant";

export type ResultadoGuardar =
  | { ok: true; updatedAt: string | null }
  | { ok: false; errores: string[] };

export type ResultadoLeerSeccion = { ok: true; valor: unknown } | { ok: false; error: string };

export type ResultadoFirma =
  | { ok: true; key: string; url: string; headers: { "content-type": string }; urlPublica: string }
  | { ok: false; errores: string[] };

/** Un producto del catálogo, tal como lo necesita el selector de destacados. */
export type ProductoBusqueda = { sku: string; nombre: string; foto?: string };

export type ResultadoBusquedaProductos =
  | { ok: true; productos: ProductoBusqueda[] }
  | { ok: false; errores: string[] };

const SIN_PERMISO = "No tiene permisos para editar la página de inicio.";
const SECCION_DESCONOCIDA = "La sección indicada no existe.";
const VISIBILIDAD_DESCONOCIDA = "Indique dónde se muestra la sección.";
const ERROR_GUARDAR = "No se pudo guardar la sección. Inténtelo de nuevo.";
const R2_NO_CONFIGURADO = "El almacenamiento de imágenes no está configurado. Avise al administrador.";
const TAMANO_INVALIDO = "La imagen supera el tamaño permitido (5 MB).";
const ERROR_FIRMA = "No se pudo preparar la subida. Inténtelo de nuevo.";
const ERROR_BUSQUEDA = "No se pudo buscar productos. Inténtelo de nuevo.";
const SIN_PERMISO_SECCION = "No tiene permisos para editar esta sección.";
const ERROR_LEER = "No se pudo cargar la sección. Inténtelo de nuevo.";
const SIN_PERMISO_LEGAL = "No tiene permisos para editar los datos legales.";
const ERROR_GUARDAR_LEGAL = "No se pudieron guardar los datos legales. Inténtelo de nuevo.";

const ANCHO_HOME = 1600;
const TTL_FIRMA_S = 600;
const MAX_BYTES_VARIANTE = 5 * 1024 * 1024;
/** Tope de resultados del selector: alcanza para elegir a mano, sin paginar. */
const LIMITE_BUSQUEDA_PRODUCTOS = 20;

function esSeccionValida(seccion: string): boolean {
  return (SECCIONES_HOME as readonly string[]).includes(seccion);
}

/**
 * Datos de UNA sección para el editor, tal como los ve la home (fila de
 * home_content mergeada con el default, mismo `combinarContenidoHome`). El
 * Dialog la pide al abrirse: así la home no manda los datos del editor en su
 * payload ni necesita saber si quien la mira es admin (performance-mobile-shop
 * 4a). Solo admin. Nunca lanza.
 */
export async function leerSeccionParaEditar(seccion: string): Promise<ResultadoLeerSeccion> {
  if (!(await esAdmin())) return { ok: false, error: SIN_PERMISO_SECCION };
  if (!esSeccionValida(seccion)) return { ok: false, error: SECCION_DESCONOCIDA };

  try {
    const payload = await leerSeccionHome(seccion);
    const filas = payload === undefined ? [] : [{ key: seccion, payload }];
    return { ok: true, valor: combinarContenidoHome(filas)[seccion as SeccionHome] };
  } catch (err) {
    console.error(`[home-acciones] no se pudo leer ${seccion}:`, err);
    return { ok: false, error: ERROR_LEER };
  }
}

/**
 * Guarda una sección completa de la home. `navBadge` admite `payload: null`
 * (= apagar el badge; se persiste como jsonb 'null', ver `home-guardar.ts`).
 * Nunca lanza hacia quien la llama.
 */
export async function guardarSeccion(seccion: string, payload: unknown): Promise<ResultadoGuardar> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };
  if (!esSeccionValida(seccion)) return { ok: false, errores: [SECCION_DESCONOCIDA] };

  if (!(seccion === "navBadge" && payload === null)) {
    const errores = erroresSeccion(seccion, payload);
    if (errores.length > 0) return { ok: false, errores };
  }

  try {
    const { updatedAt } = await guardarSeccionHome(seccion, payload);
    revalidatePath("/", "layout");
    return { ok: true, updatedAt: updatedAt?.toISOString() ?? null };
  } catch (err) {
    console.error(`[home-acciones] no se pudo guardar ${seccion}:`, err);
    return { ok: false, errores: [ERROR_GUARDAR] };
  }
}

/**
 * Borra la fila de una sección: vuelve al default de código. Para `navBadge`
 * el default trae badge, así que esto es "restablecer", no "apagar" (eso es
 * `guardarSeccion("navBadge", null)`). Nunca lanza.
 */
export async function restablecerSeccion(seccion: string): Promise<ResultadoGuardar> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };
  if (!esSeccionValida(seccion)) return { ok: false, errores: [SECCION_DESCONOCIDA] };

  try {
    await borrarSeccionHome(seccion);
    revalidatePath("/", "layout");
    return { ok: true, updatedAt: null };
  } catch (err) {
    console.error(`[home-acciones] no se pudo restablecer ${seccion}:`, err);
    return { ok: false, errores: [ERROR_GUARDAR] };
  }
}

/**
 * Define dónde se ve una sección: siempre, solo en desktop, solo en mobile o
 * nunca. No toca el contenido de la sección: la visibilidad vive en su propia
 * fila (`ocultas`), así que "Restablecer valores originales" no la cambia.
 * Nunca lanza.
 */
export async function cambiarVisibilidadSeccion(seccion: string, visibilidad: string): Promise<ResultadoGuardar> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };
  if (!esSeccionValida(seccion)) return { ok: false, errores: [SECCION_DESCONOCIDA] };
  if (!(VISIBILIDADES as readonly string[]).includes(visibilidad)) return { ok: false, errores: [VISIBILIDAD_DESCONOCIDA] };

  try {
    const mapa = { ...resolverVisibilidad(await leerSeccionHome(KEY_OCULTAS)), [seccion]: visibilidad };
    const { updatedAt } = await guardarSeccionHome(KEY_OCULTAS, resolverVisibilidad(mapa));
    revalidatePath("/", "layout");
    return { ok: true, updatedAt: updatedAt?.toISOString() ?? null };
  } catch (err) {
    console.error(`[home-acciones] no se pudo cambiar la visibilidad de ${seccion}:`, err);
    return { ok: false, errores: [ERROR_GUARDAR] };
  }
}

/**
 * Guarda los datos legales del comercio (razón social, CUIT, domicilio, correo
 * y enlace del QR de Data Fiscal) en la fila `legal` de home_content. Revalida
 * el layout entero: el footer los muestra en todas las páginas. Nunca lanza.
 */
export async function guardarDatosLegales(payload: unknown): Promise<ResultadoGuardar> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO_LEGAL] };

  const validado = validarDatosLegales(payload);
  if (!validado.ok) return validado;

  try {
    const { updatedAt } = await guardarSeccionHome(KEY_LEGAL, validado.datos);
    revalidatePath("/", "layout");
    return { ok: true, updatedAt: updatedAt?.toISOString() ?? null };
  } catch (err) {
    console.error("[home-acciones] no se pudieron guardar los datos legales:", err);
    return { ok: false, errores: [ERROR_GUARDAR_LEGAL] };
  }
}

/**
 * Firma un PUT directo a R2 para UNA variante webp de 1600 px. La key la arma
 * el servidor (el cliente no elige key ni content-type). Nunca lanza.
 */
export async function firmarSubidaImagenHome(input: { bytes: number }): Promise<ResultadoFirma> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };

  const r2 = getShopMediaR2();
  if (!r2) return { ok: false, errores: [R2_NO_CONFIGURADO] };

  const bytes = Number(input?.bytes);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES_VARIANTE) {
    return { ok: false, errores: [TAMANO_INVALIDO] };
  }

  let tenantId: string;
  try {
    tenantId = shopTenantId();
  } catch {
    // Sin SHOP_TENANT_ID el Shop no opera; para el admin es el mismo caso
    // que "almacenamiento no configurado", no un error genérico.
    return { ok: false, errores: [R2_NO_CONFIGURADO] };
  }

  try {
    const key = homeImagenKey(tenantId, randomUUID(), ANCHO_HOME);
    const { url, headers } = await r2.presignPut(key, {
      contentType: "image/webp",
      contentLength: bytes,
      ttlSeconds: TTL_FIRMA_S,
    });
    const urlPublica = urlPublicaHome(key);
    if (!urlPublica) return { ok: false, errores: [R2_NO_CONFIGURADO] };
    return { ok: true, key, url, headers, urlPublica };
  } catch (err) {
    console.error("[home-acciones] no se pudo firmar la subida:", err);
    return { ok: false, errores: [ERROR_FIRMA] };
  }
}

/**
 * Busca productos del espejo del catálogo para el selector de SKUs curados de
 * `destacados` (rebanada D). Solo admin. Sin `q` no consulta la DB (evita
 * traer 20 productos al azar cuando el buscador está vacío). Los productos
 * sin `sku` se descartan: `elegirDestacados` cura por SKU, así que no sirven
 * para armar `skus`. Nunca lanza.
 */
export async function buscarProductosHome(q: string): Promise<ResultadoBusquedaProductos> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };

  const busqueda = typeof q === "string" ? q.trim() : "";
  if (!busqueda) return { ok: true, productos: [] };

  try {
    const productos = await getCatalogo({ busqueda, limit: LIMITE_BUSQUEDA_PRODUCTOS });
    return {
      ok: true,
      productos: productos
        .filter((p): p is typeof p & { sku: string } => !!p.sku)
        .map((p) => ({ sku: p.sku, nombre: p.name, foto: p.images?.[0]?.url })),
    };
  } catch (err) {
    console.error("[home-acciones] no se pudo buscar productos:", err);
    return { ok: false, errores: [ERROR_BUSQUEDA] };
  }
}
