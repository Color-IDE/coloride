import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type ComposerModelOption } from "./modelCatalog";
import {
  MODEL_FLYOUT_WIDTH,
  MODEL_HOVER_TIP_HEIGHT,
  MODEL_HOVER_TIP_WIDTH,
  MODEL_MENU_GAP,
  MODEL_MENU_WIDTH,
  MODEL_TIP_GAP,
  placeBesideRect,
  placeMenuAboveTrigger,
  type FloatingBox,
} from "./modelMenuPosition";

export function useComposerModelMenu(autoModel: boolean) {
  const [composerModelOpen, setComposerModelOpen] = useState(false);

  const [composerModelsFlyoutOpen, setComposerModelsFlyoutOpen] =
    useState(false);
  const [modelMenuPos, setModelMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [modelFlyoutPos, setModelFlyoutPos] = useState<FloatingBox | null>(
    null,
  );
  const [modelHoverTip, setModelHoverTip] = useState<{
    option: ComposerModelOption;
    top: number;
    left: number;
    side: "left" | "right";
    caretOffsetY: number;
  } | null>(null);

  const composerModelRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const modelMenuPanelRef = useRef<HTMLDivElement>(null);
  const modelFlyoutPanelRef = useRef<HTMLDivElement>(null);
  const modelSubmenuBtnRef = useRef<HTMLButtonElement>(null);

  const closeComposerModelMenus = useCallback(() => {
    setComposerModelOpen(false);
    setComposerModelsFlyoutOpen(false);
    setModelHoverTip(null);
    setModelMenuPos(null);
    setModelFlyoutPos(null);
  }, []);

  const repositionModelFlyout = useCallback(() => {
    if (!composerModelsFlyoutOpen) {
      setModelFlyoutPos(null);
      return;
    }
    // Read this after the main menu has been painted at its final height.
    // Auto hides Reasoning, which changes that height substantially.
    const menuRect = modelMenuPanelRef.current?.getBoundingClientRect();
    if (!menuRect) return;
    const flyoutEl = modelFlyoutPanelRef.current;
    const flyoutHeight = flyoutEl?.offsetHeight || 96;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceLeft = menuRect.left - MODEL_MENU_GAP;
    const spaceRight = vw - menuRect.right - MODEL_MENU_GAP;
    let side: "left" | "right" = "left";
    if (spaceLeft < MODEL_FLYOUT_WIDTH && spaceRight >= MODEL_FLYOUT_WIDTH)
      side = "right";
    else if (
      spaceLeft < MODEL_FLYOUT_WIDTH &&
      spaceRight < MODEL_FLYOUT_WIDTH
    ) {
      side = spaceRight >= spaceLeft ? "right" : "left";
    }
    let left =
      side === "left"
        ? menuRect.left - MODEL_MENU_GAP - MODEL_FLYOUT_WIDTH
        : menuRect.right + MODEL_MENU_GAP;
    left = Math.max(8, Math.min(left, vw - MODEL_FLYOUT_WIDTH - 8));
    let top = menuRect.bottom - flyoutHeight;
    top = Math.max(8, Math.min(top, vh - flyoutHeight - 8));
    setModelFlyoutPos({ top, left, side });
  }, [composerModelsFlyoutOpen]);

  const repositionModelMenus = useCallback(() => {
    const trigger = modelTriggerRef.current;
    if (!trigger || !composerModelOpen) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuEl = modelMenuPanelRef.current;
    const menuHeight = menuEl?.offsetHeight || 280;
    setModelMenuPos(
      placeMenuAboveTrigger(triggerRect, MODEL_MENU_WIDTH, menuHeight),
    );

    repositionModelFlyout();
  }, [autoModel, composerModelOpen, repositionModelFlyout]);

  useLayoutEffect(() => {
    if (!composerModelOpen) {
      setComposerModelsFlyoutOpen(false);
      setModelHoverTip(null);
      setModelMenuPos(null);
      setModelFlyoutPos(null);
      return;
    }
    repositionModelMenus();
    const onResize = () => repositionModelMenus();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [composerModelOpen, composerModelsFlyoutOpen, repositionModelMenus]);

  // `setModelMenuPos` moves the main menu on the next paint. Re-read its
  // geometry immediately afterwards, otherwise the side flyout uses its old
  // coordinates when Auto adds/removes the Reasoning rows.
  useLayoutEffect(() => {
    if (!composerModelsFlyoutOpen || !modelMenuPos) return;
    const frame = window.requestAnimationFrame(repositionModelFlyout);
    return () => window.cancelAnimationFrame(frame);
  }, [
    autoModel,
    composerModelsFlyoutOpen,
    modelMenuPos,
    repositionModelFlyout,
  ]);

  useEffect(() => {
    if (!composerModelOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (composerModelRef.current?.contains(target)) return;
      if (modelMenuPanelRef.current?.contains(target)) return;
      if (modelFlyoutPanelRef.current?.contains(target)) return;
      closeComposerModelMenus();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modelHoverTip) {
        setModelHoverTip(null);
        return;
      }
      if (composerModelsFlyoutOpen) {
        setComposerModelsFlyoutOpen(false);
        setModelHoverTip(null);
        return;
      }
      closeComposerModelMenus();
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [
    closeComposerModelMenus,
    composerModelOpen,
    composerModelsFlyoutOpen,
    modelHoverTip,
  ]);

  const showModelHoverTip = useCallback(
    (option: ComposerModelOption, row: HTMLElement) => {
      const rect = row.getBoundingClientRect();
      // Prefer the opposite side of the flyout so tip doesn't cover the main menu.
      const prefer: "left" | "right" =
        modelFlyoutPos?.side === "right" ? "right" : "left";
      const box = placeBesideRect(
        rect,
        MODEL_HOVER_TIP_WIDTH,
        MODEL_HOVER_TIP_HEIGHT,
        MODEL_TIP_GAP,
        prefer,
      );
      setModelHoverTip({
        option,
        top: box.top,
        left: box.left,
        side: box.side,
        caretOffsetY: box.caretOffsetY ?? MODEL_HOVER_TIP_HEIGHT / 2,
      });
    },
    [modelFlyoutPos?.side],
  );

  return {
    composerModelOpen,
    setComposerModelOpen,
    composerModelsFlyoutOpen,
    setComposerModelsFlyoutOpen,
    modelMenuPos,
    setModelMenuPos,
    modelFlyoutPos,
    setModelFlyoutPos,
    modelHoverTip,
    setModelHoverTip,
    composerModelRef,
    modelTriggerRef,
    modelMenuPanelRef,
    modelFlyoutPanelRef,
    modelSubmenuBtnRef,
    closeComposerModelMenus,
    repositionModelFlyout,
    repositionModelMenus,
    showModelHoverTip,
  };
}
