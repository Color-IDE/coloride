export const MODEL_HOVER_TIP_WIDTH = 248;
/** Approximate tip card height — used to clamp above the dock when the window is short. */
export const MODEL_HOVER_TIP_HEIGHT = 320;
export const MODEL_MENU_WIDTH = 184;
export const MODEL_FLYOUT_WIDTH = 184;
export const MODEL_MENU_GAP = 8;
export const MODEL_TIP_GAP = 12;

export type FloatingBox = {
  top: number;
  left: number;
  side: "left" | "right";
  /** Distance from tip top to caret center — keeps pincho on the hovered row when tip shifts up/down. */
  caretOffsetY?: number;
};

/** Place a fixed panel next to an anchor, flipping left/right and clamping vertically so it stays on-screen. */
export function placeBesideRect(
  anchor: DOMRect,
  width: number,
  height: number,
  gap = MODEL_TIP_GAP,
  prefer: "left" | "right" = "left",
): FloatingBox {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;
  const spaceLeft = anchor.left - gap;
  const spaceRight = vw - anchor.right - gap;
  let side: "left" | "right" = prefer;
  if (prefer === "left" && spaceLeft < width && spaceRight >= width) side = "right";
  else if (prefer === "right" && spaceRight < width && spaceLeft >= width) side = "left";
  else if (spaceLeft < width && spaceRight >= spaceLeft) side = "right";
  else if (spaceRight < width && spaceLeft > spaceRight) side = "left";

  let left = side === "left" ? anchor.left - gap - width : anchor.right + gap;
  left = Math.max(pad, Math.min(left, vw - width - pad));

  const anchorCenterY = anchor.top + anchor.height / 2;
  // Ideal: vertically center on the row; if clipped (small window), shift up/down.
  let top = anchorCenterY - height / 2;
  top = Math.max(pad, Math.min(top, vh - height - pad));
  // Caret stays aimed at the row even when the card was pushed up.
  const caretMin = 22;
  const caretMax = Math.max(caretMin, height - 22);
  const caretOffsetY = Math.max(caretMin, Math.min(anchorCenterY - top, caretMax));
  return { top, left, side, caretOffsetY };
}

export function placeMenuAboveTrigger(trigger: DOMRect, width: number, estimatedHeight: number, preferBelow = false): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = trigger.right - width;
  left = Math.max(8, Math.min(left, vw - width - 8));
  // Prefer above the trigger; if not enough room, drop below.
  const above = trigger.top - MODEL_MENU_GAP - estimatedHeight;
  const below = trigger.bottom + MODEL_MENU_GAP;
  let top = preferBelow && below + estimatedHeight <= vh - 8
    ? below
    : above >= 8 ? above : Math.min(below, vh - estimatedHeight - 8);
  top = Math.max(8, top);
  return { top, left };
}
