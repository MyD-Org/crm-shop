# Central Led interactive background

Generated with the built-in image_gen tool. Original: public/images/central-led/studio-off.png.
Web asset: public/images/central-led/studio-off.webp (1536 × 1024).

## Prompt

Use case: product-mockup. Asset: premium photorealistic lighting showroom website hero background, wide landscape 1536x1024. Quiet architectural studio in beige off-white pale gray and matte black. Left 50 percent entirely empty warm pale plaster wall for existing dark website text. All products on right half, separated clearly with no overlap: unlit abstract circular white neon tube mounted on wall near 65% x 38% y; a small black ceiling spotlight near 78% x 20% y aimed downward; a black pendant lamp hanging near 88% x 39% y; an upright frosted bulb in small black socket on stone shelf near 65% x 70% y; horizontal unlit linear LED bar on wall near 78% x 55% y. Pale stone shelf across lower right, small discreet electrician pliers and screwdriver at far right on shelf. All lamps OFF, no emission no glowing halos no light beams. Soft neutral ambient daylight, realistic tactile plaster, brushed metal and glass, refined luxury catalog photography, straight architectural lines. Keep each emitting surface clearly visible to overlay light later. No words, no lettering, no logos, no watermarks. Photographic not illustration.

## Integration

The existing DS Hero still receives imageSrc. Its text, headings, CTAs, USP icons and editor remain unchanged.
Only the default neutral image is upgraded; custom editorial images retain their existing behavior.
On desktop the overlay and image use the same contain/right-center geometry. On mobile the photo is the full-card background like any hero image: cover anchored at 88% horizontally (COVER_X), and the overlay follows the same crop.
Measured emitting surfaces: neon ellipse (996,346), radii (118,117); bulb (1221,672; moved from 1006 in the photo so the mobile CTA does not cover it), radii (46,45); spot (1188,146), rotated -33°; pendant (1385,410), radii (98,6); linear rectangle (1087,527), 355 × 11.

Mouse uses independent smooth distance falloff and 300ms opacity transitions.
Touch and keyboard buttons toggle independently with aria-pressed and visible keyboard focus.
The visible intro runs linear → spot → pendant once per mount, 1.4 s per lamp with a 900 ms fade, cancels on interaction, and is disabled for reduced motion.
No new dependencies, DS modifications, production configuration or deployment.

## Verification

Chrome headless tested the real InteractiveHero and installed DS Hero together in an isolated fixture at 1440, 820 and 390px. The fixture uses the app's compiled CSS and default hero copy; it does not exercise the complete home, navigation destinations or backend. The running local home returns the existing coming-soon gate, which was left unchanged.

Passed: source-image/SVG alignment at all three widths; CTA hit testing; exact content subtree HTML comparison with the unwrapped DS Hero; keyboard Space/Enter and focus outline; independent touch toggles; reduced-motion transitions disabled; mouse proximity independence; mobile intro waits for scene visibility and cancels on interaction. TypeScript, scoped ESLint and three geometry tests also pass after the review fixes.

Review fixes: remove the DS section's isolated stacking context only inside this wrapper, place art at -15 between image -20 and veil -10, keep text/CTAs at 1 and hotspot controls at 0, and observe the scene surface at 35% intersection. The unrelated EscenaLuces implementation remains on disk but is not mounted by HomeClient.
