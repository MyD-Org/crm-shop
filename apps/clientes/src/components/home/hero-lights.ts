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

/** Matches object-fit: contain; object-position: right center. */
export function sceneRect(width: number, height: number) {
  const scale = Math.min(width / 1536, height / 1024);
  return { scale, width: 1536 * scale, height: 1024 * scale,
    left: width - 1536 * scale, top: (height - 1024 * scale) / 2 };
}

export const STUDIO_IMAGE = "/images/central-led/studio-off.webp";
export function isStudioImage(src: string) {
  return src === "/images/hero-neutral.webp" || src === STUDIO_IMAGE;
}
