import {
  File01Icon,
  Files01Icon,
  HierarchySquare01Icon,
  Plug01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../../shared/ui/Icon";
import { GitIcon } from "../../explorer/filetree/FileTree";
import { pluginArtworkSrc } from "../SlashCommandMenu";
import { mcpPluginId } from "./formatting";

export function LikeIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 12.5C2 11.3954 2.89543 10.5 4 10.5C5.65685 10.5 7 11.8431 7 13.5V17.5C7 19.1569 5.65685 20.5 4 20.5C2.89543 20.5 2 19.6046 2 18.5V12.5Z" />
      <path d="M15.4787 7.80626L15.2124 8.66634C14.9942 9.37111 14.8851 9.72349 14.969 10.0018C15.0369 10.2269 15.1859 10.421 15.389 10.5487C15.64 10.7065 16.0197 10.7065 16.7791 10.7065H17.1831C19.7532 10.7065 21.0382 10.7065 21.6452 11.4673C21.7145 11.5542 21.7762 11.6467 21.8296 11.7437C22.2965 12.5921 21.7657 13.7351 20.704 16.0211C19.7297 18.1189 19.2425 19.1678 18.338 19.7852C18.2505 19.8449 18.1605 19.9013 18.0683 19.9541C17.116 20.5 15.9362 20.5 13.5764 20.5H13.0646C10.2057 20.5 8.77628 20.5 7.88814 19.6395C7 18.7789 7 17.3939 7 14.6239V13.6503C7 12.1946 7 11.4668 7.25834 10.8006C7.51668 10.1344 8.01135 9.58664 9.00069 8.49112L13.0921 3.96056C13.1947 3.84694 13.246 3.79012 13.2913 3.75075C13.7135 3.38328 14.3652 3.42464 14.7344 3.84235C14.774 3.8871 14.8172 3.94991 14.9036 4.07554C15.0388 4.27205 15.1064 4.37031 15.1654 4.46765C15.6928 5.33913 15.8524 6.37436 15.6108 7.35715C15.5838 7.46692 15.5488 7.5801 15.4787 7.80626Z" />
    </svg>
  );
}

export function DislikeIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 11.5C2 12.6046 2.89543 13.5 4 13.5C5.65685 13.5 7 12.1569 7 10.5V6.5C7 4.84315 5.65685 3.5 4 3.5C2.89543 3.5 2 4.39543 2 5.5V11.5Z" />
      <path d="M15.4787 16.1937L15.2124 15.3337C14.9942 14.6289 14.8851 14.2765 14.969 13.9982C15.0369 13.7731 15.1859 13.579 15.389 13.4513C15.64 13.2935 16.0197 13.2935 16.7791 13.2935H17.1831C19.7532 13.2935 21.0382 13.2935 21.6452 12.5327C21.7145 12.4458 21.7762 12.3533 21.8296 12.2563C22.2965 11.4079 21.7657 10.2649 20.704 7.9789C19.7297 5.88111 19.2425 4.83222 18.338 4.21485C18.2505 4.15508 18.1605 4.0987 18.0683 4.04586C17.116 3.5 15.9362 3.5 13.5764 3.5H13.0646C10.2057 3.5 8.77628 3.5 7.88814 4.36053C7 5.22106 7 6.60607 7 9.37607V10.3497C7 11.8054 7 12.5332 7.25834 13.1994C7.51668 13.8656 8.01135 14.4134 9.00069 15.5089L13.0921 20.0394C13.1947 20.1531 13.246 20.2099 13.2913 20.2493C13.7135 20.6167 14.3652 20.5754 14.7344 20.1577C14.774 20.1129 14.8172 20.0501 14.9036 19.9245C15.0388 19.728 15.1064 19.6297 15.1654 19.5323C15.6928 18.6609 15.8524 17.6256 15.6108 16.6429C15.5838 16.5331 15.5488 16.4199 15.4787 16.1937Z" />
    </svg>
  );
}

export function CopyMessageIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M7 11V9C7 5.70017 7 4.05025 8.02513 3.02513C9.05025 2 10.7002 2 14 2C17.2998 2 18.9497 2 19.9749 3.02513C21 4.05025 21 5.70017 21 9V11C21 14.2998 21 15.9497 19.9749 16.9749C18.9497 18 17.2998 18 14 18C10.7002 18 9.05025 18 8.02513 16.9749C7 15.9497 7 14.2998 7 11Z" />
      <path d="M3 6V15C3 18.2998 3 19.9497 4.02513 20.9749C5.05025 22 6.70017 22 10 22H17" />
    </svg>
  );
}

export function CopyCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function LinearToolMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M2.25 14.3c-.04-.19.18-.31.32-.17l7.3 7.3c.14.14.02.36-.17.32c-3.68-.86-6.59-3.77-7.45-7.45m-.24-2.93q0 .09.06.15l10.41 10.41s.1.06.15.06c.47-.03.94-.09 1.39-.19c.15-.03.21-.22.1-.33L2.52 9.89a.194.194 0 0 0-.33.1c-.09.46-.16.92-.19 1.39Zm.84-3.44c-.03.07-.02.16.04.22L15.84 21.1c.06.06.15.07.22.04c.36-.16.7-.34 1.04-.54c.09-.06.12-.18.07-.27c0-.01-.02-.03-.03-.04L3.69 6.87a.193.193 0 0 0-.28 0c-.01.01-.02.02-.03.04c-.2.33-.38.68-.54 1.04ZM4.54 5.6a.19.19 0 0 1 0-.27a10 10 0 0 1 7.47-3.34c5.53 0 10.01 4.48 10.01 10.01c0 2.97-1.29 5.63-3.34 7.47c-.08.07-.2.07-.27 0L4.53 5.61Z" />
    </svg>
  );
}

export function pluginToolMark(pluginId: string) {
  if (pluginId === "linear") return <LinearToolMark />;
  const artwork = pluginArtworkSrc(pluginId);
  if (artwork)
    return <img alt="" className="agent-mcp-tool-mark" src={artwork} />;
  return <Icon icon={Plug01Icon} size={15} />;
}

export function ContextCompactIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M11.9961 3V6" />
      <path d="M11.9961 18V21" />
      <path d="M20.9961 12H17.9961" />
      <path d="M5.99609 12H2.99609" />
      <path d="M18.3596 5.63672L16.2383 7.75804" />
      <path d="M7.75413 16.2422L5.63281 18.3635" />
      <path d="M18.3596 18.3635L16.2383 16.2422" />
      <path d="M7.75413 7.75804L5.63281 5.63672" />
    </svg>
  );
}

export function ThoughtIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.14286 14C4.41735 12.8082 4 11.4118 4 9.91886C4 5.54539 7.58172 2 12 2C16.4183 2 20 5.54539 20 9.91886C20 11.4118 19.5827 12.8082 18.8571 14"
        strokeLinecap="round"
      />
      <path d="M7.38287 17.0982C7.291 16.8216 7.24507 16.6833 7.25042 16.5713C7.26174 16.3343 7.41114 16.1262 7.63157 16.0405C7.73579 16 7.88105 16 8.17157 16H15.8284C16.119 16 16.2642 16 16.3684 16.0405C16.5889 16.1262 16.7383 16.3343 16.7496 16.5713C16.7549 16.6833 16.709 16.8216 16.6171 17.0982C16.4473 17.6094 16.3624 17.8651 16.2315 18.072C15.9572 18.5056 15.5272 18.8167 15.0306 18.9408C14.7935 19 14.525 19 13.9881 19H10.0119C9.47495 19 9.2065 19 8.96944 18.9408C8.47283 18.8167 8.04281 18.5056 7.7685 18.072C7.63755 17.8651 7.55266 17.6094 7.38287 17.0982Z" />
      <path d="M15 19L14.8707 19.6466C14.7293 20.3537 14.6586 20.7072 14.5001 20.9866C14.2552 21.4185 13.8582 21.7439 13.3866 21.8994C13.0816 22 12.7211 22 12 22C11.2789 22 10.9184 22 10.6134 21.8994C10.1418 21.7439 9.74484 21.4185 9.49987 20.9866C9.34144 20.7072 9.27073 20.3537 9.12932 19.6466L9 19" />
      <path
        d="M8.25 9.75L10.5 12L10.5 16M8.25 10.5C8.66421 10.5 9 10.1642 9 9.75C9 9.33579 8.66421 9 8.25 9C7.83579 9 7.5 9.33579 7.5 9.75C7.5 10.1642 7.83579 10.5 8.25 10.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.75 9.75L13.5 12L13.5 16M15.75 10.5C15.3358 10.5 15 10.1642 15 9.75C15 9.33579 15.3358 9 15.75 9C16.1642 9 16.5 9.33579 16.5 9.75C16.5 10.1642 16.1642 10.5 15.75 10.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReadFileIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M17.5055 2.01874C12.8289 2.83455 12 7.5 12 7.5V22C12 22 12.8867 17.1272 18.0004 16.5588C18.5493 16.4978 19 16.0576 19 15.5058V3.39309C19 2.5654 18.3216 1.87638 17.5055 2.01874Z" />
      <path d="M5.33333 5.00001C7.79379 4.99657 10.1685 5.88709 12 7.5V22C10.1685 20.3871 7.79379 19.4966 5.33333 19.5C3.77132 19.5 2.99032 19.5 2.64526 19.2792C2.4381 19.1466 2.35346 19.0619 2.22086 18.8547C2 18.5097 2 17.8941 2 16.6629V8.40322C2 6.97543 2 6.26154 2.54874 5.68286C3.09748 5.10418 3.65923 5.07432 4.78272 5.0146C4.965 5.00491 5.14858 5.00001 5.33333 5.00001Z" />
      <path d="M12 22.001C13.8315 20.3881 16.2062 19.4976 18.6667 19.501C20.2287 19.501 21.0097 19.501 21.3547 19.2802C21.5619 19.1476 21.6465 19.0629 21.7791 18.8558C22 18.5107 22 17.8951 22 16.6639V8.40424C22 6.97645 22 6.26256 21.4513 5.68388C20.9025 5.1052 20.1235 5.05972 19 5" />
    </svg>
  );
}

export function ListFilesIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 8H21" />
      <path d="M12 12H17" />
      <path d="M12 20H17" />
      <path d="M12 16H21" />
      <path d="M3 4V11C3 12.8692 3 13.8038 3.40192 14.5C3.66523 14.9561 4.04394 15.3348 4.5 15.5981C5.19615 16 6.13077 16 8 16" />
      <path d="M8 8H7C6.07003 8 5.60504 8 5.22354 7.89778C4.18827 7.62038 3.37962 6.81173 3.10222 5.77646C3 5.39496 3 4.92997 3 4" />
    </svg>
  );
}

export function SearchFilesIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M17 17L21 21" />
      <path d="M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z" />
    </svg>
  );
}

export function MovePathIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.0469 5.44865L14.4101 7.54728L14.4101 7.54728C17.5034 8.75771 19.05 9.36293 18.9988 10.323C18.9475 11.283 17.3334 11.7232 14.1051 12.6036C13.1439 12.8658 12.6633 12.9969 12.3301 13.3301C11.9969 13.6633 11.8658 14.1439 11.6036 15.1051C10.7232 18.3334 10.283 19.9475 9.32296 19.9988C8.36293 20.05 7.75771 18.5034 6.54728 15.4101L6.54728 15.4101L4.44865 10.0469C3.18138 6.80831 2.54774 5.18901 3.36837 4.36837C4.18901 3.54774 5.80831 4.18138 9.0469 5.44865Z" />
      <path d="M21 18.5L14 18.5" strokeLinecap="round" />
    </svg>
  );
}

export function RenamePathIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 16C5.07003 16 4.60504 16 4.22354 15.8978C3.18827 15.6204 2.37962 14.8117 2.10222 13.7765C2 13.395 2 12.93 2 12C2 11.07 2 10.605 2.10222 10.2235C2.37962 9.18827 3.18827 8.37962 4.22354 8.10222C4.60504 8 5.07003 8 6 8M12 16H18C18.93 16 19.395 16 19.7765 15.8978C20.8117 15.6204 21.6204 14.8117 21.8978 13.7765C22 13.395 22 12.93 22 12C22 11.07 22 10.605 21.8978 10.2235C21.6204 9.18827 20.8117 8.37962 19.7765 8.10222C19.395 8 18.93 8 18 8H12" />
      <path d="M7 3H9M11 3H9M9 3V21M9 21H7M9 21H11" strokeLinejoin="round" />
    </svg>
  );
}

export function DeletePathIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14.5 19.5H13.5C10.6716 19.5 9.25736 19.5 8.37868 18.6213C7.5 17.7426 7.5 16.3284 7.5 13.5V11.5M7.5 8V11.5M7.5 11.5H12.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.5 19.5C14.5 18.3215 14.5 17.7322 14.8515 17.3661C15.2029 17 15.7686 17 16.9 17H18.1C19.2314 17 19.7971 17 20.1485 17.3661C20.5 17.7322 20.5 18.3215 20.5 19.5C20.5 20.6785 20.5 21.2678 20.1485 21.6339C19.7971 22 19.2314 22 18.1 22H16.9C15.7686 22 15.2029 22 14.8515 21.6339C14.5 21.2678 14.5 20.6785 14.5 19.5Z" />
      <path d="M5.78571 2H9.21429C11.2888 2 11.5 3.10993 11.5 5C11.5 6.89007 11.2888 8 9.21429 8H5.78571C3.7112 8 3.5 6.89007 3.5 5C3.5 3.10993 3.7112 2 5.78571 2Z" />
      <path
        d="M19.5 9.5L17.5 11.5M17.5 11.5L15.5 13.5M17.5 11.5L19.5 13.5M17.5 11.5L15.5 9.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GitStatusIcon() {
  return <GitIcon className="size-4 shrink-0" />;
}

export function GitDiffIcon() {
  return <GitIcon className="size-4 shrink-0" />;
}

export function FetchUrlIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" />
      <path
        d="M8 12C8 18 12 22 12 22C12 22 16 18 16 12C16 6 12 2 12 2C12 2 8 6 8 12Z"
        strokeLinejoin="round"
      />
      <path d="M21 15H3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 9H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Spark globe — Analyzing / Analyzed browser tool rows. */
export function AnalyzeBrowserIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M11.5379 8.32172C11.6966 7.89276 12.3034 7.89276 12.4621 8.32172L13.1735 10.2443C13.2733 10.514 13.486 10.7267 13.7557 10.8265L15.6783 11.5379C16.1072 11.6966 16.1072 12.3034 15.6783 12.4621L13.7557 13.1735C13.486 13.2733 13.2733 13.486 13.1735 13.7557L12.4621 15.6783C12.3034 16.1072 11.6966 16.1072 11.5379 15.6783L10.8265 13.7557C10.7267 13.486 10.514 13.2733 10.2443 13.1735L8.32172 12.4621C7.89276 12.3034 7.89276 11.6966 8.32172 11.5379L10.2443 10.8265C10.514 10.7267 10.7267 10.514 10.8265 10.2443L11.5379 8.32172Z" />
      <circle cx="12" cy="12" r="10" />
      <path
        d="M8 8C8.67327 4.46819 10.2109 2 12 2C13.7891 2 15.3267 4.46819 16 8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 16C8.67327 19.5318 10.2109 22 12 22C13.7891 22 15.3267 19.5318 16 16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 12H4.5M22 12H19.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DiagnosticsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 20C6.13623 20 5.20435 20 4.46927 19.6955C3.48915 19.2895 2.71046 18.5108 2.30448 17.5307C2 16.7956 2 15.8638 2 14V10C2 8.13623 2 7.20435 2.30448 6.46927C2.71046 5.48915 3.48915 4.71046 4.46927 4.30448C5.20435 4 6.13623 4 8 4" />
      <path d="M22 10V14C22 15.8638 22 16.7956 21.6955 17.5307C21.2895 18.5108 20.5108 19.2895 19.5307 19.6955C18.7956 20 17.8638 20 16 20" />
      <path d="M12 2V22" />
      <path d="M19.5 2.9375V4.5M19.5 4.5V6.0625M19.5 4.5H18.25M19.5 4.5H20.75M22 4.5L20.9156 4.13852C20.4179 3.97263 20.0274 3.58211 19.8615 3.08443L19.5 2L19.1385 3.08443C18.9726 3.58211 18.5821 3.97263 18.0844 4.13852L17 4.5L18.0844 4.86148C18.5821 5.02737 18.9726 5.41789 19.1385 5.91557L19.5 7L19.8615 5.91557C20.0274 5.41789 20.4179 5.02737 20.9156 4.86148L22 4.5Z" />
    </svg>
  );
}

export function StartProcessIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14.0022 4.5C14.3777 4.16667 14.6984 4 15.0682 4C15.7664 4 16.2898 4.59409 17.3368 5.78228L19.9115 8.70448C21.3038 10.2847 22 11.0747 22 12C22 12.9253 21.3038 13.7153 19.9115 15.2955L17.3368 18.2177C16.2898 19.4059 15.7664 20 15.0682 20C14.6984 20 14.3777 19.8333 14.0022 19.5" />
      <path d="M7 5.4398C7.86196 4.47993 8.35392 4 8.98862 4C9.69478 4 10.2243 4.59409 11.2832 5.78228L13.8875 8.70448C15.2959 10.2847 16 11.0747 16 12C16 12.9253 15.2959 13.7153 13.8876 15.2955L11.2832 18.2177C10.2243 19.4059 9.69478 20 8.98862 20C8.35392 20 7.86196 19.5201 7 18.5602" />
      <path d="M5.5 15.5L5.5 8.5M2 12H9" />
    </svg>
  );
}

export function ReadProcessIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2.5 8.18677C2.60406 6.08705 2.91537 4.77792 3.84664 3.84664C4.77792 2.91537 6.08705 2.60406 8.18677 2.5M21.5 8.18677C21.3959 6.08705 21.0846 4.77792 20.1534 3.84664C19.2221 2.91537 17.9129 2.60406 15.8132 2.5M15.8132 21.5C17.9129 21.3959 19.2221 21.0846 20.1534 20.1534C21.0846 19.2221 21.3959 17.9129 21.5 15.8132M8.18676 21.5C6.08705 21.3959 4.77792 21.0846 3.84664 20.1534C2.91537 19.2221 2.60406 17.9129 2.5 15.8132" />
      <path d="M16 7V17" />
      <path d="M12 7V13" />
      <path d="M12 17V17.01" />
      <path d="M8 7V17" />
    </svg>
  );
}

export function StopProcessIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14.002 4.5C14.3775 4.16667 14.6982 4 15.068 4C15.7661 4 16.2896 4.59409 17.3365 5.78228L19.9113 8.70448C21.3036 10.2847 21.9998 11.0747 21.9998 12C21.9998 12.9253 21.3036 13.7153 19.9113 15.2955L17.3365 18.2177C16.2896 19.4059 15.7661 20 15.068 20C14.6982 20 14.3775 19.8333 14.002 19.5" />
      <path d="M7 5.4398C7.86196 4.47993 8.35392 4 8.98862 4C9.69478 4 10.2243 4.59409 11.2832 5.78228L13.8875 8.70448C15.2959 10.2847 16 11.0747 16 12C16 12.9253 15.2959 13.7153 13.8876 15.2955L11.2832 18.2177C10.2243 19.4059 9.69478 20 8.98862 20C8.35392 20 7.86196 19.5201 7 18.5602" />
      <path d="M2 12H9" />
    </svg>
  );
}

export function WriteFileIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M3.49977 18.9853V20.5H5.01449C6.24074 20.5 6.85387 20.5 7.40518 20.2716C7.9565 20.0433 8.39004 19.6097 9.25713 18.7426L19.1211 8.87868C20.0037 7.99612 20.4449 7.55483 20.4937 7.01325C20.5018 6.92372 20.5018 6.83364 20.4937 6.74411C20.4449 6.20253 20.0037 5.76124 19.1211 4.87868C18.2385 3.99612 17.7972 3.55483 17.2557 3.50605C17.1661 3.49798 17.0761 3.49798 16.9865 3.50605C16.4449 3.55483 16.0037 3.99612 15.1211 4.87868L5.25713 14.7426C4.39004 15.6097 3.9565 16.0433 3.72813 16.5946C3.49977 17.1459 3.49977 17.759 3.49977 18.9853Z" />
      <path d="M13.5 6.5L17.5 10.5" />
    </svg>
  );
}

export function EditFileIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M3.78181 16.3092L3 21L7.69086 20.2182C8.50544 20.0825 9.25725 19.6956 9.84119 19.1116L20.4198 8.53288C21.1934 7.75922 21.1934 6.5049 20.4197 5.73126L18.2687 3.58024C17.495 2.80658 16.2406 2.80659 15.4669 3.58027L4.88841 14.159C4.30447 14.7429 3.91757 15.4947 3.78181 16.3092Z" />
      <path d="M14 6L18 10" />
    </svg>
  );
}

export function CreateDirectoryIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14.5 17.5V7.5H7.5001C5.1431 7.5 3.9646 7.5 3.23237 8.23222C2.50013 8.96445 2.50012 10.1429 2.5001 12.5L2.50006 16.5C2.50004 18.857 2.50003 20.0355 3.23226 20.7678C3.9645 21.5 5.14302 21.5 7.50006 21.5H10.5C12.3856 21.5 13.3284 21.5 13.9142 20.9142C14.5 20.3284 14.5 19.3856 14.5 17.5Z" />
      <path d="M14.4999 16.5H16.4999C18.8569 16.5 20.0355 16.5 20.7677 15.7678C21.4999 15.0355 21.4999 13.857 21.4999 11.5V7.5C21.4999 5.14298 21.4999 3.96447 20.7677 3.23223C20.0355 2.5 18.8569 2.5 16.4999 2.5H9.50006L9.5002 7.5" />
      <path d="M5.50006 12.5H9.00006M5.50006 16.5H11.5001" />
      <path d="M9.50006 2.5L14.5001 7.5" />
    </svg>
  );
}

export function SwitchUserIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18.0003 21C18.0003 19.0567 18.0003 18.085 17.6949 17.3226C17.374 16.5211 16.8218 15.8695 16.1306 15.4764C15.4731 15.1025 14.5003 15 12.92 15.0044L11.0799 15C9.50027 15 8.5465 15.0916 7.89721 15.4525C7.18422 15.8489 6.62044 16.5129 6.29586 17.3386C6.00028 18.0906 6.00028 19.0604 6.00027 21" />
      <path d="M7.00027 12C5.33783 12.0611 4.50661 12.0916 3.86749 12.4525C3.16567 12.8489 2.61072 13.5129 2.29123 14.3386C2.00028 15.0906 2.00028 16.0604 2.00027 18" />
      <path d="M17.0003 12C18.6755 12.0655 19.513 12.0982 20.1602 12.4724C20.8404 12.8657 21.3839 13.5179 21.6998 14.3199C22.0003 15.0829 22.0003 16.0553 22.0003 18" />
      <path d="M15.0003 9C15.0003 10.6569 13.6571 12 12.0003 12C10.3434 12 9.00027 10.6569 9.00027 9C9.00027 7.34315 10.3434 6 12.0003 6C13.6571 6 15.0003 7.34315 15.0003 9Z" />
      <path d="M10.0003 3.76389C9.46952 3.28885 8.76863 3 8.00027 3C6.34342 3 5.00027 4.34315 5.00027 6C5.00027 7.04349 5.53303 7.96254 6.34138 8.5" />
      <path d="M14.002 3.76365C14.5328 3.28861 15.2337 2.99976 16.002 2.99976C17.6589 2.99976 19.002 4.3429 19.002 5.99976C19.002 7.04324 18.4693 7.9623 17.6609 8.49976" />
    </svg>
  );
}

export function ChangeWorkspaceIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15.5766 13.8983L15.9282 11.7497C16.0058 11.2757 16.0446 11.0386 15.9175 11.0039C15.7905 10.9692 15.6021 11.1654 15.2254 11.5577L10 17" />
      <path d="M8.42338 10.1017L8.07175 12.2503C7.99417 12.7243 7.95538 12.9614 8.08246 12.9961C8.20954 13.0308 8.39789 12.8346 8.77459 12.4423L14 7" />
      <path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z" />
    </svg>
  );
}

export function ExpandChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="m6 10l6 6l6-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function toolIcon(tool: string) {
  if (tool === "list_files")
    return <Icon icon={HierarchySquare01Icon} size={15} />;
  if (tool === "read_file") return <Icon icon={File01Icon} size={15} />;
  if (tool === "search_files") return <SearchFilesIcon />;
  if (tool === "write_file") return <WriteFileIcon />;
  if (tool === "replace_in_file") return <EditFileIcon />;
  if (tool === "create_directory") return <CreateDirectoryIcon />;
  if (tool === "rename_path") return <RenamePathIcon />;
  if (tool === "move_path") return <MovePathIcon />;
  if (tool === "delete_path") return <DeletePathIcon />;
  if (["create_terminal", "run_terminal_command"].includes(tool))
    return <StartProcessIcon />;
  if (["list_terminals", "read_terminal"].includes(tool))
    return <ReadProcessIcon />;
  if (tool === "start_process") return <StartProcessIcon />;
  if (tool === "read_process") return <ReadProcessIcon />;
  if (tool === "stop_process") return <StopProcessIcon />;
  if (tool === "get_diagnostics") return <DiagnosticsIcon />;
  if (tool === "fetch_url") return <FetchUrlIcon />;
  if (tool.startsWith("browser_")) return <AnalyzeBrowserIcon />;
  if (tool === "git_status") return <GitStatusIcon />;
  if (tool === "git_diff") return <GitDiffIcon />;
  if (tool === "change_workspace") return <ChangeWorkspaceIcon />;
  if (tool === "switch_user") return <SwitchUserIcon />;
  if (tool.startsWith("mcp__")) return pluginToolMark(mcpPluginId(tool));
  return <Icon icon={Files01Icon} size={15} />;
}
