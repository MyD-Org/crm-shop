/**
 * Contexto de pantalla que el Shop manda con cada mensaje del chat
 * (`AiChatConfig.getPageContext` de ai-widget → `page_context` → ai-api lo
 * inyecta como `<contexto_de_pantalla>`). Contrato:
 * platform/contracts/contexto-pantalla-shop/v1.
 *
 * Compacto a propósito: viaja en CADA turno, así que cada campo cuesta tokens
 * siempre. Tope de ~600 caracteres serializado (`TOPE_CONTEXTO`): si no entra,
 * se acortan los nombres de los productos y, en último caso, se mandan menos.
 *
 * Sin datos personales: ni cuenta, ni precios de la lista del cliente, ni
 * dirección. El único texto del usuario es `interpretado` (la consulta que se
 * interpretó). Módulo puro: lo usa el cliente para armar el contexto.
 */
import { nombreAtributo } from "./catalogo-atributos";
import { consultaInterpretada, hrefCatalogo, type EstadoCatalogo } from "./catalogo-url";
import { formatMarca, formatRubro } from "./formato-rubro";

export type PaginaShop = "inicio" | "catalogo" | "producto" | "carrito" | "otra";

export interface FiltroContexto {
  tipo: "categoria" | "marca" | "atributo";
  id: string;
  nombre: string;
}

/** Forma del contrato `contexto-pantalla-shop/v1`. */
export interface ContextoPantallaShop {
  v: 1;
  pagina: PaginaShop;
  catalogo?: {
    /** Query string vigente, sin `?` ("q=reflector&atr=tono-calido"). */
    url: string;
    total: number;
    /** Hasta 5 productos de la página visible, en orden. */
    primeros: { id: string; nombre: string }[];
    filtros: FiltroContexto[];
    interpretado?: string;
  };
  producto?: { id: string; nombre: string; codigo?: string };
  carrito?: { lineas: number };
}

/** Tope del contexto serializado (contrato: ~600 caracteres). */
export const TOPE_CONTEXTO = 600;
/** Productos de la página visible que viajan como máximo. */
export const MAX_PRIMEROS = 5;

/** Lo que sabe la página en la que está el visitante. */
export interface EntradaContexto {
  pathname: string;
  catalogo?: {
    estado: EstadoCatalogo;
    total: number;
    productos: readonly { id: string; name: string }[];
  };
  producto?: { id: string; name: string; sku?: string };
  carrito?: { lineas: number };
}

/** Página del Shop según la ruta. */
export function paginaDe(pathname: string): PaginaShop {
  const ruta = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (ruta === "/") return "inicio";
  if (ruta === "/catalogo") return "catalogo";
  if (ruta.startsWith("/producto/")) return "producto";
  if (ruta === "/carrito") return "carrito";
  return "otra";
}

const recortar = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Filtros aplicados con su nombre visible, en el orden del panel. */
function filtrosDe(estado: EstadoCatalogo): FiltroContexto[] {
  return [
    ...estado.categorias.map((id) => ({ tipo: "categoria" as const, id, nombre: formatRubro(id) })),
    ...estado.marcas.map((id) => ({ tipo: "marca" as const, id, nombre: formatMarca(id) })),
    ...estado.atributos.map((id) => ({ tipo: "atributo" as const, id, nombre: nombreAtributo(id) })),
  ];
}

const largo = (c: ContextoPantallaShop) => JSON.stringify(c).length;

/**
 * Contexto compacto para la página actual. Garantiza el tope de
 * `TOPE_CONTEXTO` caracteres: acorta nombres (60 → 40 → 24) y, si aun así no
 * entra, saca productos del final (y, en el caso extremo, filtros).
 */
export function contextoPantalla(entrada: EntradaContexto): ContextoPantallaShop {
  const pagina = paginaDe(entrada.pathname);
  const contexto: ContextoPantallaShop = { v: 1, pagina };

  if (pagina === "producto" && entrada.producto) {
    const { id, name, sku } = entrada.producto;
    contexto.producto = { id, nombre: recortar(name, 80), ...(sku && sku !== name ? { codigo: recortar(sku, 40) } : {}) };
  }
  if (pagina === "carrito" && entrada.carrito) {
    contexto.carrito = { lineas: Math.max(0, Math.trunc(entrada.carrito.lineas)) };
  }
  if (pagina !== "catalogo" || !entrada.catalogo) return contexto;

  const { estado, total, productos } = entrada.catalogo;
  const interpretado = consultaInterpretada(estado);
  const url = hrefCatalogo(estado).replace(/^\/catalogo\??/, "");
  const base = {
    url: recortar(url, 200),
    total,
    filtros: filtrosDe(estado).map((f) => ({ ...f, nombre: recortar(f.nombre, 40) })),
    ...(interpretado ? { interpretado: recortar(interpretado, 80) } : {}),
  };
  const conPrimeros = (cantidad: number, max: number, filtros = base.filtros): ContextoPantallaShop => ({
    ...contexto,
    catalogo: {
      ...base,
      filtros,
      primeros: productos.slice(0, cantidad).map((p) => ({ id: p.id, nombre: recortar(p.name, max) })),
    },
  });
  for (let cantidad = Math.min(productos.length, MAX_PRIMEROS); cantidad > 0; cantidad--) {
    for (const max of [60, 40, 24]) {
      const candidato = conPrimeros(cantidad, max);
      if (largo(candidato) <= TOPE_CONTEXTO) return candidato;
    }
  }
  // Ni un producto entra (muchísimos filtros): se mandan los filtros que entren.
  let filtros = base.filtros;
  while (filtros.length > 0 && largo(conPrimeros(0, 24, filtros)) > TOPE_CONTEXTO) filtros = filtros.slice(0, -1);
  return conPrimeros(0, 24, filtros);
}
