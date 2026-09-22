/**
 * Íconos de Mi cuenta. SVG inline con `currentColor`: el color lo pone el
 * componente del DS que los contiene (SectionNav, StatCard, Button). Ancho y
 * alto numéricos son el tamaño intrínseco del dibujo, no estilo. Todos son
 * decorativos (`aria-hidden`): el texto de al lado dice lo mismo.
 */
import type { ReactNode } from "react";
import type { IdSeccion } from "@/lib/mi-cuenta-nav";

function Svg({ size = 20, fill = "none", children }: { size?: number; fill?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconoPedidos({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </Svg>
  );
}

export function IconoFactura({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Svg>
  );
}

/** Corazón de favoritos: `relleno` cuando está guardado. */
export function IconoCorazon({ size, relleno = false }: { size?: number; relleno?: boolean }) {
  return (
    <Svg size={size} fill={relleno ? "currentColor" : "none"}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </Svg>
  );
}

export function IconoPin({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Svg>
  );
}

export function IconoCamion({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M1 4h14v12H1z" />
      <path d="M15 8h4l3 3v5h-7V8Z" />
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="18.5" cy="18.5" r="2" />
    </Svg>
  );
}

export function IconoPersona({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  );
}

export function IconoEscudo({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function IconoSalir({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}

export function IconoCarrito({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.5L22 8H6" />
    </Svg>
  );
}

export function IconoFlecha({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  );
}

export function IconoRefresh({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
    </Svg>
  );
}

export function IconoDescarga({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  );
}

/** Placeholder de la miniatura de una línea sin foto. */
export function IconoLampara({ size = 22 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </Svg>
  );
}

/** Ícono de cada sección de la navegación de Mi cuenta. */
export const ICONOS_SECCION: Record<IdSeccion, ReactNode> = {
  pedidos: <IconoPedidos />,
  facturas: <IconoFactura />,
  favoritos: <IconoCorazon />,
  direcciones: <IconoPin />,
  envios: <IconoCamion />,
  datos: <IconoPersona />,
  seguridad: <IconoEscudo />,
  salir: <IconoSalir />,
};
