/** Coordinates measured on studio-off (1536 × 1024), shared by SVG and controls. */
export const HERO_LIGHTS = [
  { id: "neon", label: "Neón circular", x: 996, y: 346, radius: 180 },
  { id: "bulb", label: "Bombilla", x: 1006, y: 671, radius: 140 },
  { id: "spot", label: "Spot", x: 1188, y: 146, radius: 150 },
  { id: "pendant", label: "Colgante", x: 1385, y: 410, radius: 180 },
  { id: "linear", label: "Luminaria lineal", x: 1265, y: 533, radius: 210 },
] as const;

export function proximity(x: number, y: number, light: typeof HERO_LIGHTS[number]) {
  const distance = Math.hypot(x - light.x, y - light.y);
  const t = Math.max(0, 1 - distance / light.radius);
  return t * t * (3 - 2 * t);
}

/** Horizontal anchor of the mobile cover crop; must match object-position in the CSS module. */
export const COVER_X = .88;
/** Viewports that use the mobile cover layout (the CSS module's mobile media query). */
export const COVER_QUERY = "(max-width: 767px)";

/**
 * Where the 1536 × 1024 source lands inside the hero. Desktop matches
 * object-fit: contain; object-position: right center. Mobile matches
 * object-fit: cover; object-position: 88% bottom, inside a 10:9 box at the
 * bottom of the card (height-bound, so top is 0).
 */
export function sceneRect(width: number, height: number, cover = false) {
  const scale = cover ? Math.max(width / 1536, height / 1024) : Math.min(width / 1536, height / 1024);
  return { scale, width: 1536 * scale, height: 1024 * scale,
    left: (width - 1536 * scale) * (cover ? COVER_X : 1), top: (height - 1024 * scale) / 2 };
}

export const STUDIO_IMAGE = "/images/central-led/studio-off.webp";
export function isStudioImage(src: string) {
  return src === "/images/hero-neutral.webp" || src === STUDIO_IMAGE;
}
