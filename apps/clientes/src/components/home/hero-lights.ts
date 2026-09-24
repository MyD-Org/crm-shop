/** Coordinates measured on studio-off (1536 × 1024), shared by SVG and controls. */
export const HERO_LIGHTS = [
  { id: "neon", label: "Neón circular", x: 996, y: 346, radius: 180 },
  { id: "bulb", label: "Lámpara de mesa BELL-N", x: 1221, y: 660, radius: 140 },
  { id: "spot", label: "Spot", x: 1188, y: 146, radius: 150 },
  { id: "pendant", label: "Colgante de bambú", x: 1385, y: 357, radius: 180 },
  { id: "linear", label: "Luminaria lineal", x: 1265, y: 533, radius: 210 },
] as const;

type Light = { readonly id: string; readonly x: number; readonly y: number; readonly radius: number };

export function proximity(x: number, y: number, light: Light) {
  const distance = Math.hypot(x - light.x, y - light.y);
  const t = Math.max(0, 1 - distance / light.radius);
  return t * t * (3 - 2 * t);
}

/** Horizontal anchor of the mobile cover crop; must match object-position in the CSS module. */
export const COVER_X = .88;
/** Viewports where the photo covers the card (the CSS module's mobile media query). */
export const COVER_QUERY = "(max-width: 767px)";

/**
 * Where the 1536 × 1024 source lands inside the hero. Desktop matches
 * object-fit: contain; object-position: right center. Mobile matches
 * object-fit: cover; object-position: 88% center.
 */
export function sceneRect(width: number, height: number, cover = false) {
  const scale = cover ? Math.max(width / 1536, height / 1024) : Math.min(width / 1536, height / 1024);
  return { scale, width: 1536 * scale, height: 1024 * scale,
    left: (width - 1536 * scale) * (cover ? COVER_X : 1), top: (height - 1024 * scale) / 2 };
}

export const STUDIO_IMAGE = "/images/central-led/studio-bell-bamboo-v2.webp";
/** Mobile crop of the same studio without the neon ring, which fights the title on a phone. */
export const STUDIO_IMAGE_MOBILE = "/images/central-led/studio-bell-bamboo-v2-mobile.webp";
/** Lights missing from the mobile photo: no glow, no control, left out of the intro and scroll. */
export const COVER_HIDDEN_LIGHTS: ReadonlySet<string> = new Set(["neon"]);
/**
 * Lights that sit elsewhere in the mobile photo, in source px. The linear bar is gone
 * from its wall there; its light is a hidden strip under the shelf (x 786-1536, y 884).
 */
export const COVER_LIGHT_SHIFT: Readonly<Record<string, { dx: number; dy: number }>> = { linear: { dx: -104, dy: 357 } };
/** The under-shelf strip of the mobile photo, in source px. */
export const COVER_SHELF_STRIP = { x: 786, y: 884, width: 750 } as const;
/** Where a light is in the photo this viewport shows. */
export function lightAt<T extends Light>(light: T, cover: boolean): T {
  const shift = cover ? COVER_LIGHT_SHIFT[light.id] : undefined;
  return shift ? { ...light, x: light.x + shift.dx, y: light.y + shift.dy } : light;
}
export function isStudioImage(src: string) {
  return src === "/images/hero-neutral.webp" || src === "/images/central-led/studio-off.webp" || src === STUDIO_IMAGE;
}
