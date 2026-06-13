/**
 * ADR-007 layout acceptance: integer-scaled 4:3 playfield in both
 * orientations, NES/Game Boy control placement, device-aware hints
 * (touch devices never see keyboard keys), 48px+ buttons.
 */
import { test, expect, type Page } from '@playwright/test';

const LOGICAL = { w: 256, h: 192 };

const VIEWPORTS: Record<string, { w: number; h: number }> = {
  'iphone-se': { w: 375, h: 667 },
  'iphone-15': { w: 393, h: 852 },
  'iphone-15-pro-max': { w: 430, h: 932 },
  desktop: { w: 1280, h: 800 },
};

const isTouchProject = (name: string): boolean => name !== 'desktop';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The playfield must be an integer device-pixel multiple of 256×192, 4:3, on-screen. */
async function expectIntegerPlayfield(page: Page): Promise<Box> {
  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  expect(box).toBeTruthy();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const devW = Math.round(box.width * dpr);
  const devH = Math.round(box.height * dpr);
  expect(devW % LOGICAL.w, `canvas ${box.width}×${box.height}css @${dpr}x`).toBe(0);
  expect(devH % LOGICAL.h, `canvas ${box.width}×${box.height}css @${dpr}x`).toBe(0);
  expect(devW / LOGICAL.w).toBe(devH / LOGICAL.h); // 4:3, never stretched
  expect(devW / LOGICAL.w).toBeGreaterThanOrEqual(1);
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.y).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  return box;
}

async function expectControlPlacement(
  page: Page,
  playfield: Box,
  orientation: 'portrait' | 'landscape',
): Promise<void> {
  const dpad = (await page.locator('#dpad').boundingBox())!;
  const abzone = (await page.locator('#abzone').boundingBox())!;
  if (orientation === 'landscape') {
    // NES held sideways: d-pad in the left pillarbox bar, A/B in the right.
    expect(dpad.x + dpad.width).toBeLessThanOrEqual(playfield.x + 1);
    expect(abzone.x).toBeGreaterThanOrEqual(playfield.x + playfield.width - 1);
  } else {
    // Game Boy: controller band below the playfield, d-pad left, A/B right.
    expect(dpad.y).toBeGreaterThanOrEqual(playfield.y + playfield.height - 1);
    expect(abzone.y).toBeGreaterThanOrEqual(playfield.y + playfield.height - 1);
    expect(dpad.x + dpad.width).toBeLessThanOrEqual(abzone.x + 1);
  }
  // Buttons stay comfortably thumb-sized (≥48px target).
  for (const sel of ['.pad-btn.a', '.pad-btn.b']) {
    const btn = (await page.locator(sel).boundingBox())!;
    expect(btn.width, sel).toBeGreaterThanOrEqual(48);
    expect(btn.height, sel).toBeGreaterThanOrEqual(48);
  }
}

for (const orientation of ['portrait', 'landscape'] as const) {
  test.describe(orientation, () => {
    test.beforeEach(async ({ page }, info) => {
      if (info.project.name === 'desktop' && orientation === 'portrait') test.skip();
      const vp = VIEWPORTS[info.project.name]!;
      const [w, h] = orientation === 'portrait' ? [vp.w, vp.h] : [vp.h, vp.w];
      await page.setViewportSize({
        width: info.project.name === 'desktop' ? vp.w : w,
        height: info.project.name === 'desktop' ? vp.h : h,
      });
    });

    test('home: integer playfield, device-aware hints, controls in place', async ({ page }, info) => {
      const touch = isTouchProject(info.project.name);
      await page.goto('/');
      const playfield = await expectIntegerPlayfield(page);

      if (touch) {
        await expect(page.locator('.keys')).toBeHidden(); // never keyboard legends on touch
        await expect(page.locator('#start-gate .gate-label.touch-only')).toBeVisible();
        await expect(page.locator('#dpad')).toBeVisible();
        await expectControlPlacement(page, playfield, orientation);
      } else {
        await expect(page.locator('.keys')).toBeVisible();
        await expect(page.locator('#dpad')).toBeHidden();
        await expect(page.locator('#start-gate .gate-label.keys-only')).toBeVisible();
      }

      // Start solo play so the screenshot shows the real game, then re-verify
      // the playfield didn't move when the gate left.
      await page.locator('#start-gate').click();
      await page.waitForTimeout(350);
      await expectIntegerPlayfield(page);
      await page.screenshot({
        path: `e2e/screenshots/${info.project.name}-${orientation}-home.png`,
      });
    });

    test('play: join flow copy, playfield and controls after joining', async ({ page }, info) => {
      const touch = isTouchProject(info.project.name);
      await page.route('**/api/rooms/TEST', (route) =>
        route.fulfill({ json: { code: 'TEST', players: [], spectators: 0 } }),
      );
      await page.goto('/play/bubble-buddies/?room=TEST');

      // Invite/join copy is device-aware too.
      await expect(page.locator('#name-overlay')).toBeVisible();
      if (touch) {
        await expect(page.locator('#name-overlay .hint.touch-only')).toBeVisible();
        await expect(page.locator('#name-overlay .hint.keys-only')).toBeHidden();
      } else {
        await expect(page.locator('#name-overlay .hint.keys-only')).toBeVisible();
        await expect(page.locator('#name-overlay .hint.touch-only')).toBeHidden();
      }
      await page.screenshot({
        path: `e2e/screenshots/${info.project.name}-${orientation}-join.png`,
      });

      await page.fill('#name-input', 'Tess');
      await page.locator('#join-btn').click();
      await expect(page.locator('#name-overlay')).toBeHidden();

      const playfield = await expectIntegerPlayfield(page);
      if (touch) {
        await expect(page.locator('.keys')).toBeHidden();
        await expectControlPlacement(page, playfield, orientation);
      } else {
        await expect(page.locator('.keys')).toBeVisible();
      }
      await page.screenshot({
        path: `e2e/screenshots/${info.project.name}-${orientation}-play.png`,
      });
    });
  });
}
