import { describe, expect, it } from "vitest";
import { COVER_X, HERO_LIGHTS, SHELF_STRIP, STUDIO_IMAGE, isStudioImage, proximity, sceneRect } from "./hero-lights";

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
  it("covers the whole mobile card with the crop anchored at COVER_X", () => {
    for (const [width, height] of [[358, 760], [343, 640], [700, 820]]) {
      const rect = sceneRect(width, height, true);
      expect(rect.width).toBeGreaterThanOrEqual(width - 1e-9);
      expect(rect.height).toBeGreaterThanOrEqual(height - 1e-9);
      expect(rect.left).toBeCloseTo((width - rect.width) * COVER_X);
      expect(rect.top * 2 + rect.height).toBeCloseTo(height);
    }
  });
  it("puts the linear light on the under-shelf strip at every size", () => {
    const linear = HERO_LIGHTS.find(light => light.id === "linear")!;
    expect(linear).toMatchObject({ x: SHELF_STRIP.x + 375, y: 890 });
    expect(linear.x).toBeGreaterThan(SHELF_STRIP.x);
    expect(linear.x).toBeLessThan(SHELF_STRIP.x + SHELF_STRIP.width);
  });
  it("gives every lamp a tap area around the whole fixture, without overlaps", () => {
    for (const light of HERO_LIGHTS) {
      const { hit } = light;
      expect(light.x).toBeGreaterThanOrEqual(hit.x);
      expect(light.x).toBeLessThanOrEqual(hit.x + hit.width);
      expect(light.y).toBeGreaterThanOrEqual(hit.y);
      expect(light.y).toBeLessThanOrEqual(hit.y + hit.height);
      expect(hit.x + hit.width).toBeLessThanOrEqual(1536);
      expect(hit.width).toBeGreaterThanOrEqual(200);
    }
    for (const a of HERO_LIGHTS) for (const b of HERO_LIGHTS) {
      if (a === b) continue;
      const apart = a.hit.x + a.hit.width <= b.hit.x || b.hit.x + b.hit.width <= a.hit.x
        || a.hit.y + a.hit.height <= b.hit.y || b.hit.y + b.hit.height <= a.hit.y;
      expect(apart, `${a.id} / ${b.id}`).toBe(true);
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
    expect(isStudioImage("/images/central-led/studio-off.webp")).toBe(true);
    expect(isStudioImage("/images/central-led/studio-bell-bamboo-v2.webp")).toBe(true);
    expect(isStudioImage(STUDIO_IMAGE)).toBe(true);
    expect(isStudioImage("/images/custom.webp")).toBe(false);
  });
});
