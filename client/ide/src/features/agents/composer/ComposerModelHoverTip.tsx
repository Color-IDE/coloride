import type { CSSProperties } from "react";
import type { ComposerModelOption } from "./modelCatalog";
import { ComposerModelTooltip } from "../../../shared/ui/composer/ComposerModelTooltip";

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
  return (
    <ComposerModelTooltip
      description={option.description}
      side={side}
      caretOffsetY={caretOffsetY}
      style={style}
      stats={
        option.detailsUnavailable
          ? undefined
          : [
              { label: "Price", value: option.price },
              { label: "Coding", value: option.coding },
              { label: "Visual", value: option.visual },
            ]
      }
      tokenPrice={
        option.detailsUnavailable
          ? undefined
          : { input: option.inputPerM, output: option.outputPerM }
      }
    />
  );
}
