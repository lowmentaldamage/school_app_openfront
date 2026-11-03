/**
 * DeviceProfile — picks 3D rendering budgets for the device class.
 *
 * Phones and tablets have high device-pixel ratios on GPUs with far less
 * fill rate, so they start at a lower quality level, skip MSAA (the
 * adaptive pixel-ratio cap is cheaper and looks better at high DPR), and use
 * a smaller terrain vertex budget. Pure: callers pass the environment in,
 * so the policy is unit tested.
 */

export interface DeviceSignals {
  coarsePointer: boolean;
  maxTouchPoints: number;
  /** Shorter side of the screen in CSS pixels. */
  screenShortSide: number;
  /** navigator.userAgentData?.mobile when available. */
  uaMobile?: boolean;
}

export interface DeviceProfile {
  mobile: boolean;
  /** Starting index into QUALITY_LEVELS. */
  initialQuality: number;
  /** Highest index adaptive quality may climb to. */
  maxQuality: number;
  antialias: boolean;
  /** Target vertex count for terrain LOD 0 across the whole map. */
  terrainVertexBudget: number;
}

export function profileFor(s: DeviceSignals): DeviceProfile {
  const mobile =
    s.uaMobile === true ||
    (s.coarsePointer && s.maxTouchPoints > 0 && s.screenShortSide < 900);
  return mobile
    ? {
        mobile,
        initialQuality: 1,
        maxQuality: 2,
        antialias: false,
        terrainVertexBudget: 300_000,
      }
    : {
        mobile,
        initialQuality: 3,
        maxQuality: 3,
        antialias: true,
        terrainVertexBudget: 1_500_000,
      };
}

export function detectDeviceProfile(): DeviceProfile {
  const nav = globalThis.navigator as
    | (Navigator & { userAgentData?: { mobile?: boolean } })
    | undefined;
  const screen = globalThis.screen as Screen | undefined;
  return profileFor({
    coarsePointer:
      globalThis.matchMedia?.("(pointer: coarse)").matches ?? false,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    screenShortSide: screen ? Math.min(screen.width, screen.height) : 1080,
    uaMobile: nav?.userAgentData?.mobile,
  });
}
