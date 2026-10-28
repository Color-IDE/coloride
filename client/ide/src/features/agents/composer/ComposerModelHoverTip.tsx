import type { CSSProperties } from "react";
import { ModelStatBars } from "./ComposerModelDetails";
import type { ComposerModelOption } from "./modelCatalog";

export function ComposerModelHoverTip({
  option,
  side = "left",
  caretOffsetY,
  style,
}: {
  option: ComposerModelOption;
  side?: "left" | "right";
  /** px from tip top to caret center (follows the hovered model row). */
  caretOffsetY?: number;
  style?: CSSProperties;
}) {
  const formatPerM = (value: number) => {
    const text = String(value);
    return `$${text}/M tok`;
  };

  return (
    <div
      className={`agent-model-hover-tip is-visible is-side-${side}`}
      role="tooltip"
      style={style}
    >
      <p className="agent-model-tip-desc">{option.description}</p>
      {!option.detailsUnavailable && <>
      <div className="agent-model-tip-stats">
        <div className="agent-model-tip-row">
          <span className="agent-model-tip-key">Price</span>
          <ModelStatBars filled={option.price} />
        </div>
        <div className="agent-model-tip-row">
          <span className="agent-model-tip-key">Coding</span>
          <ModelStatBars filled={option.coding} />
        </div>
        <div className="agent-model-tip-row">
          <span className="agent-model-tip-key">Visual</span>
          <ModelStatBars filled={option.visual} />
        </div>
      </div>
      <div className="agent-model-tip-divider" />
      <div className="agent-model-tip-token-head">Token price</div>
      <div className="agent-model-tip-token-row">
        <span>In: {formatPerM(option.inputPerM)}</span>
        <span>Out: {formatPerM(option.outputPerM)}</span>
      </div>
      </>}
      <span
        aria-hidden="true"
        className="agent-model-hover-tip-caret"
        style={
          typeof caretOffsetY === "number"
            ? { top: caretOffsetY, transform: "translateY(-50%) rotate(45deg)" }
            : undefined
        }
      />
    </div>
  );
}
