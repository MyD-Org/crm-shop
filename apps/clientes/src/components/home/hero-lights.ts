/** Coordinates measured on studio-off (1536 × 1024), shared by SVG and controls. */
export const HERO_LIGHTS = [
  { id: "neon", label: "Neón flexible", x: 1044, y: 370, radius: 210 },
  { id: "bulb", label: "Lámpara de mesa BELL-N", x: 1221, y: 660, radius: 140 },
  { id: "spot", label: "Spot", x: 1188, y: 146, radius: 150 },
  { id: "pendant", label: "Colgante de bambú", x: 1385, y: 357, radius: 180 },
  { id: "linear", label: "Tira LED bajo la mesada", x: 1161, y: 890, radius: 210 },
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

/**
 * The studio with no wall fixtures: the neon is drawn over it as a free-form tube
 * (NEON_PATH) and the linear light is a hidden strip under the shelf (SHELF_STRIP),
 * the same at every size.
 */
export const STUDIO_IMAGE = "/images/central-led/studio-bell-bamboo-v3.webp";
/** Phones get the same photo; kept separate so the mobile source can change on its own. */
export const STUDIO_IMAGE_MOBILE = STUDIO_IMAGE;
/** Lights left out on phones (the neon fights the title there): no tube, glow, control, intro or scroll. */
export const COVER_HIDDEN_LIGHTS: ReadonlySet<string> = new Set(["neon"]);
/** The under-shelf strip, in source px. */
export const SHELF_STRIP = { x: 786, y: 884, width: 750 } as const;
/**
 * Flexible neon tube on the wall, in source px: it comes in from the left with a soft
 * wave, loops back over itself and falls away to the right, like a coil of neon flex.
 */
export const NEON_PATH = "M836 402 C880 372 930 420 990 426 C1080 436 1160 400 1160 330 C1160 262 1080 236 1010 246 C930 258 900 318 948 360 C1000 404 1110 420 1180 440 C1220 452 1244 470 1252 494";
/** Studio photos the home may have stored; any of them renders as STUDIO_IMAGE. */
const STUDIO_IMAGES: ReadonlySet<string> = new Set([
  "/images/hero-neutral.webp",
  "/images/central-led/studio-off.webp",
  "/images/central-led/studio-bell-bamboo-v2.webp",
  STUDIO_IMAGE,
]);
export function isStudioImage(src: string) {
  return STUDIO_IMAGES.has(src);
}
