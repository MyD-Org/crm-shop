import { describe, expect, it } from "vitest";
import { HERO_LIGHTS, isStudioImage, proximity, sceneRect } from "./hero-lights";

describe("studio lighting geometry", () => {
  it("keeps the entire source aligned with contain at desktop and touch sizes", () => {
    for (const [width, height] of [[1280, 600], [344, 297], [1920, 680]]) {
      const rect = sceneRect(width, height);
      expect(rect.left + rect.width).toBeCloseTo(width);
      expect(rect.top * 2 + rect.height).toBeCloseTo(height);
      for (const light of HERO_LIGHTS) {
        const screenX = rect.left + light.x * rect.scale;
        const screenY = rect.top + light.y * rect.scale;
        expect(screenX).toBeGreaterThan(0);
        expect(screenX).toBeLessThan(width);
        expect(screenY).toBeGreaterThan(0);
        expect(screenY).toBeLessThan(height);
      }
    }
  });
  it("uses independent continuous falloff, with exact off outside the radius", () => {
    const light = HERO_LIGHTS[1];
    expect(proximity(light.x, light.y, light)).toBe(1);
    expect(proximity(light.x + light.radius / 2, light.y, light)).toBeCloseTo(.5);
    expect(proximity(light.x + light.radius, light.y, light)).toBe(0);
    expect(proximity(light.x, light.y, HERO_LIGHTS[2])).toBe(0);
  });
  it("preserves custom editorial images without unrelated lighting overlays", () => {
    expect(isStudioImage("/images/hero-neutral.webp")).toBe(true);
    expect(isStudioImage("/images/custom.webp")).toBe(false);
  });
});
