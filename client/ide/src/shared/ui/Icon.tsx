/**
 * Coloride icons — always render via HugeiconsIcon.
 *
 * Usage:
 *   import { Icon } from "./Icon";
 *   import { SearchIcon } from "@hugeicons/core-free-icons";
 *   <Icon icon={SearchIcon} size={16} strokeWidth={1.8} className="..." />
 */
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

export type IconProps = {
  icon: IconSvgElement;
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  color?: string;
  absoluteStrokeWidth?: boolean;
  title?: string;
} & Omit<HugeiconsIconProps, "icon" | "size" | "strokeWidth" | "className" | "color" | "absoluteStrokeWidth">;

export function Icon({
  icon,
  size = 16,
  strokeWidth = 1.8,
  className,
  color = "currentColor",
  absoluteStrokeWidth,
  title,
  ...rest
}: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={absoluteStrokeWidth}
      color={color}
      className={className}
      aria-hidden={title ? undefined : true}
      {...(title ? { "aria-label": title } : {})}
      {...rest}
    />
  );
}

export { HugeiconsIcon };
export type { IconSvgElement };
