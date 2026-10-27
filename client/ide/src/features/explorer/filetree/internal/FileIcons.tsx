import { useId, type CSSProperties } from "react";

export function TreeModeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 7V5.33333C12 4.55608 12 4.16746 12.1405 3.86607C12.2896 3.54646 12.5465 3.28958 12.8661 3.14054C13.1675 3 13.5561 3 14.3333 3C14.7406 3 14.9443 3 15.1321 3.04949C15.3321 3.10217 15.519 3.19563 15.6811 3.324C15.8334 3.44459 15.9556 3.6075 16.2 3.93333L17 5H18.5C19.4346 5 19.9019 5 20.25 5.20096C20.478 5.33261 20.6674 5.52197 20.799 5.75C21 6.09808 21 6.56538 21 7.5C21 8.43462 21 8.90192 20.799 9.25C20.6674 9.47803 20.478 9.66739 20.25 9.79904C19.9019 10 19.4346 10 18.5 10H15C13.5858 10 12.8787 10 12.4393 9.56066C12 9.12132 12 8.41421 12 7Z" />
      <path d="M12 18V16.3333C12 15.5561 12 15.1675 12.1405 14.8661C12.2896 14.5465 12.5465 14.2896 12.8661 14.1405C13.1675 14 13.5561 14 14.3333 14C14.7406 14 14.9443 14 15.1321 14.0495C15.3321 14.1022 15.519 14.1956 15.6811 14.324C15.8334 14.4446 15.9556 14.6075 16.2 14.9333L17 16H18.5C19.4346 16 19.9019 16 20.25 16.201C20.478 16.3326 20.6674 16.522 20.799 16.75C21 17.0981 21 17.5654 21 18.5C21 19.4346 21 19.9019 20.799 20.25C20.6674 20.478 20.478 20.6674 20.25 20.799C19.9019 21 19.4346 21 18.5 21H15C13.5858 21 12.8787 21 12.4393 20.5607C12 20.1213 12 19.4142 12 18Z" />
      <path d="M8 7H7C6.07003 7 5.60504 7 5.22354 6.89778C4.18827 6.62038 3.37962 5.81173 3.10222 4.77646C3 4.39496 3 3.92997 3 3" />
      <path d="M3 3V13C3 14.8692 3 15.8038 3.40192 16.5C3.66523 16.9561 4.04394 17.3348 4.5 17.5981C5.19615 18 6.13077 18 8 18" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21 21-6.05-6.05m0 0a7 7 0 1 0-9.9-9.9 7 7 0 0 0 9.9 9.9Z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      className="size-3.5"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m6 18 6-6m0 0 6-6m-6 6L6 6m6 6 6 6"
        fill="none"
      />
    </svg>
  );
}

/**
 * Language logos come from different coordinate systems and include different
 * amounts of whitespace. Keep their layout box identical and compensate only
 * the painted silhouette so every row stays aligned.
 */
export const languageIconStyle = (
  scale: number,
  x = 0,
  y = 0,
): CSSProperties => ({
  transform: `translate(${x}px, ${y}px) scale(${scale})`,
  transformBox: "view-box",
  transformOrigin: "center",
});

export function PythonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 128 128"
      style={languageIconStyle(0.95)}
    >
      <path d="M0 0h128v128H0z" fill="none" />
      <path
        fill="currentColor"
        d="M49.33 62h29.159C86.606 62 93 55.132 93 46.981V19.183c0-7.912-6.632-13.856-14.555-15.176c-5.014-.835-10.195-1.215-15.187-1.191c-4.99.023-9.612.448-13.805 1.191C37.098 6.188 35 10.758 35 19.183V30h29v4H23.776c-8.484 0-15.914 5.108-18.237 14.811c-2.681 11.12-2.8 17.919 0 29.53C7.614 86.983 12.569 93 21.054 93H31V79.952C31 70.315 39.428 62 49.33 62m-1.838-39.11c-3.026 0-5.478-2.479-5.478-5.545c0-3.079 2.451-5.581 5.478-5.581c3.015 0 5.479 2.502 5.479 5.581c-.001 3.066-2.465 5.545-5.479 5.545m74.789 25.921C120.183 40.363 116.178 34 107.682 34H97v12.981C97 57.031 88.206 65 78.489 65H49.33C41.342 65 35 72.326 35 80.326v27.8c0 7.91 6.745 12.564 14.462 14.834c9.242 2.717 17.994 3.208 29.051 0C85.862 120.831 93 116.549 93 108.126V97H64v-4h43.682c8.484 0 11.647-5.776 14.599-14.66c3.047-9.145 2.916-17.799 0-29.529m-41.955 55.606c3.027 0 5.479 2.479 5.479 5.547c0 3.076-2.451 5.579-5.479 5.579c-3.015 0-5.478-2.502-5.478-5.579c0-3.068 2.463-5.547 5.478-5.547"
      />
    </svg>
  );
}

export function JavaScriptIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      viewBox="0 0 16 16"
      style={languageIconStyle(0.906)}
    >
      <path
        fillRule="evenodd"
        d="M14 0a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zM9.053 7.596v3.127l-.007 1.752q0 .498-.186.752t-.556.263q-.342 0-.528-.234-.185-.234-.185-.684v-.175H6.37v.185q0 .665.253 1.113.255.45.703.674.44.225 1.016.225.88 0 1.406-.498.527-.498.527-1.485l.007-1.752V7.596zm3.808-.108q-.585 0-1.006.244a1.67 1.67 0 0 0-.634.674 2.1 2.1 0 0 0-.225.996q0 .753.293 1.182.303.42.967.732l.469.215q.438.186.625.43.185.244.185.635 0 .478-.166.703-.156.224-.527.224-.361.001-.547-.244-.186-.243-.205-.752h-1.162q.02.996.498 1.524.479.527 1.386.527.909 0 1.417-.518.507-.517.507-1.484 0-.81-.332-1.289t-1.045-.79l-.449-.196q-.39-.166-.556-.381-.166-.214-.166-.576 0-.4.165-.596.177-.195.508-.195.361 0 .508.234.156.234.176.703h1.123q-.03-.976-.498-1.484-.47-.518-1.309-.518"
      />
    </svg>
  );
}

export function TypeScriptIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      viewBox="0 0 16 16"
      style={languageIconStyle(0.906)}
    >
      <path
        fillRule="evenodd"
        d="M14 0a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm-1.139 7.488q-.585 0-1.006.244a1.67 1.67 0 0 0-.634.674 2.1 2.1 0 0 0-.225.996q0 .753.293 1.182.303.42.967.732l.469.215q.438.186.625.43.185.244.185.635 0 .478-.166.703-.156.224-.527.224-.361.001-.547-.244-.186-.243-.205-.752h-1.162q.02.996.498 1.524.479.527 1.386.527.909 0 1.417-.518.507-.517.507-1.484 0-.81-.332-1.289t-1.045-.79l-.449-.196q-.39-.166-.556-.381-.166-.214-.166-.576 0-.4.165-.596.177-.195.508-.195.361 0 .508.234.156.234.176.703h1.123q-.03-.976-.498-1.484-.47-.518-1.309-.518M7 7.596v1.113h1.3V14.5h1.221V8.709h1.289V7.596z"
      />
    </svg>
  );
}

export function ReactIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={languageIconStyle(0.99)}
    >
      <path d="M14.25 8.101q.632.892 1.214 1.899c.387.67.733 1.34 1.037 2m-2.25-3.9A25 25 0 0 0 12 8c-.774 0-1.527.035-2.25.101m4.5 0c1.255.116 2.42.326 3.445.61m-3.444-.61A20 20 0 0 0 12 5.423m5.695 3.288C20.297 9.434 22 10.637 22 12c0 1.362-1.703 2.566-4.305 3.288m0-6.577c.675-2.613.485-4.69-.695-5.371-1.18-.682-3.074.192-5 2.083m5.695 3.288A20 20 0 0 1 16.501 12m0 0a24.6 24.6 0 0 1-2.25 3.899m2.25-3.9a20 20 0 0 1 1.194 3.29m0 0c.675 2.613.485 4.69-.695 5.37-1.18.682-3.074-.191-5-2.083m5.695-3.288c-1.025.285-2.19.495-3.444.61m0 0Q13.163 16 12 16c-.774 0-1.527-.035-2.25-.102m4.5 0A20 20 0 0 1 12 18.576m0 0c-1.926 1.892-3.82 2.765-5 2.084s-1.37-2.758-.696-5.372M12 18.576a19.7 19.7 0 0 1-2.25-2.678m0 0a25 25 0 0 1-1.214-1.899c-.387-.67-.733-1.34-1.037-2m2.25 3.899a19.7 19.7 0 0 1-3.445-.61m0 0C3.704 14.566 2 13.362 2 12c0-1.363 1.703-2.566 4.304-3.288m0 6.576c.266-1.03.667-2.144 1.195-3.288M6.304 8.712C5.63 6.097 5.82 4.02 7 3.339s3.074.192 5 2.084M6.304 8.712a20 20 0 0 1 3.445-.61m-3.445.61c.267 1.03.667 2.143 1.195 3.288M12 5.423c-.76.746-1.523 1.65-2.25 2.678m0 0Q9.117 8.995 8.535 10c-.387.67-.733 1.34-1.037 2M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  );
}

export function HtmlIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      style={languageIconStyle(0.967)}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 48 48"
    >
      <path d="M0 0h48v48H0z" fill="none" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5.41 2.216C8.567 1.916 14.63 1.5 24 1.5s15.433.416 18.59.716c2.274.216 3.935 2.146 3.874 4.4c-.338 12.356-2.953 22.975-3.89 26.425a6.56 6.56 0 0 1-1.449 2.676C35.913 41.51 29.318 44.58 26.242 45.79a6.1 6.1 0 0 1-4.484 0c-3.077-1.21-9.672-4.28-14.884-10.073a6.55 6.55 0 0 1-1.448-2.676c-.938-3.45-3.553-14.069-3.89-26.425a4.277 4.277 0 0 1 3.874-4.4M24 6.5c-5.109 0-9.017.201-11.223.351a4.394 4.394 0 0 0-4.079 4.87a66 66 0 0 0 1.493 8.444c.502 2.028 2.323 3.335 4.297 3.335H32.21a60 60 0 0 1-1.434 7.172v.004c-2.47 2.322-5.285 3.862-6.771 4.58l-.005.002l-.004-.002c-1.578-.763-4.658-2.454-7.228-5.024a2.5 2.5 0 1 0-3.535 3.536c3.136 3.136 6.78 5.116 8.588 5.99a5 5 0 0 0 4.359 0c1.808-.874 5.452-2.854 8.588-5.99c.354-.354.554-.79.687-1.257c.252-.884 1.234-4.483 1.801-9.04c.338-2.72-1.824-4.971-4.43-4.971H14.933a61 61 0 0 1-1.192-6.7c2.193-.138 5.738-.3 10.26-.3c6.91 0 11.54.378 12.547.468c1.413.127 2.789-.695 2.941-2.22c.155-1.545-1.072-2.632-2.494-2.76C35.867 6.889 31.09 6.5 24 6.5"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function CssIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      style={languageIconStyle(0.906)}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <path
        fillRule="evenodd"
        d="M14 0a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V0zM4.59 7.498q-.908 0-1.455.508-.547.507-.547 1.484v3.106q0 .986.527 1.484t1.406.498q.576 0 1.016-.224.45-.225.703-.674.255-.45.254-1.114v-.185h-1.22v.176q0 .449-.186.683t-.527.235q-.372-.01-.557-.264-.186-.255-.186-.752V9.686q0-.547.166-.811.177-.264.577-.264.321 0 .517.225.195.224.195.693v.205h1.23V9.52q0-.674-.243-1.124a1.55 1.55 0 0 0-.664-.673q-.42-.225-1.006-.225m4.214-.01q-.586 0-1.006.244a1.67 1.67 0 0 0-.635.674 2.1 2.1 0 0 0-.225.996q0 .753.293 1.182.304.42.967.732l.469.215q.44.186.625.43.186.244.186.635 0 .478-.166.703-.157.224-.528.224-.36 0-.547-.244-.185-.243-.205-.752H6.87q.02.996.498 1.524.479.527 1.387.527t1.416-.518.508-1.484q0-.81-.332-1.289-.333-.479-1.045-.79l-.45-.196q-.39-.166-.556-.381-.165-.214-.166-.576 0-.4.166-.596.175-.195.508-.195.36 0 .508.234.156.234.175.703h1.123q-.03-.976-.498-1.484-.468-.518-1.308-.518m4.057 0q-.585 0-1.006.244a1.67 1.67 0 0 0-.634.674 2.1 2.1 0 0 0-.225.996q0 .753.293 1.182.303.42.967.732l.469.215q.438.186.625.43.185.244.185.635 0 .478-.166.703-.156.224-.527.224-.361.001-.547-.244-.186-.243-.205-.752h-1.162q.02.996.498 1.524.479.527 1.386.527.909 0 1.417-.518.507-.517.507-1.484 0-.81-.332-1.289t-1.045-.79l-.449-.196q-.39-.166-.556-.381-.166-.214-.166-.576 0-.4.165-.596.177-.195.508-.195.361 0 .508.234.156.234.176.703h1.123q-.03-.976-.498-1.484-.47-.518-1.309-.518"
      />
    </svg>
  );
}

export function SassIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      style={languageIconStyle(0.906)}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <g fill="none">
        <g clipPath="url(#SVGXv8lpc2Y)">
          <path
            fill="currentColor"
            d="M12 0c6.6 0 12 5.4 12 12s-5.4 12-12 12S0 18.6 0 12S5.4 0 12 0M9.6 15.975q.225 1.012 0 1.8L9.525 18c0 .075-.075.15-.075.15c-.15.3-.3.525-.525.825c-.675.75-1.65 1.05-2.1.825s-.225-1.35.6-2.175c.9-.9 2.1-1.5 2.1-1.5zM19.5 5.1c-.525-2.1-4.05-2.85-7.425-1.65c-1.95.75-4.125 1.875-5.7 3.3c-1.875 1.725-2.1 3.225-2.025 3.825C4.8 12.75 7.8 14.25 9.075 15.3C8.7 15.45 6 16.8 5.4 18.225c-.675 1.5.075 2.55.6 2.625c1.575.45 3.225-.375 4.05-1.65s.75-2.85.375-3.675a3.53 3.53 0 0 1 1.8-.075c2.1.225 2.55 1.575 2.4 2.1s-.525.825-.675.975c-.15.075-.225.15-.15.15c0 .075.075.075.225.075s1.125-.45 1.125-1.5c.075-1.275-1.2-2.7-3.375-2.7c-.9 0-1.5.075-1.875.225c0-.075-.075-.075-.075-.075c-1.35-1.425-3.825-2.475-3.75-4.425c0-.675.3-2.55 4.8-4.8c3.675-1.875 6.675-1.35 7.2-.225c.75 1.575-1.575 4.575-5.4 5.025c-1.5.15-2.25-.375-2.4-.6c-.225-.225-.225-.225-.3-.225c-.15.075-.075.225 0 .375c.15.3.6.825 1.425 1.125c.675.225 2.4.375 4.5-.45c2.325-.9 4.125-3.375 3.6-5.475z"
          />
        </g>
        <defs>
          <clipPath id="SVGXv8lpc2Y">
            <path fill="#fff" d="M0 0h24v24H0z" />
          </clipPath>
        </defs>
      </g>
    </svg>
  );
}

export function ShellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 512 512"
      style={languageIconStyle(0.906)}
    >
      <path d="M0 0h512v512H0z" fill="none" />
      <path
        fill="currentColor"
        d="M404.858 448.69H20.423c-13.115 0-22.827-12.189-19.899-24.972l75.54-329.715C80.065 76.066 91.682 63.31 110.06 63.31h382.244c12.644 0 22.01 11.749 19.192 24.075L434.25 425.26c-3.134 13.709-15.33 23.43-29.392 23.43m-274.85-51.538l176.803-126.98c10.735-7.753 13.02-24.357 3.266-33.796L193.262 112.328c-19.247-20.44-52.1 10.498-32.853 30.937l99.144 105.286l-155.87 111.947c-24.91 17.89 1.415 54.544 26.325 36.654m216.15-43.913h-93.839c-27.033 0-27.033 40.83 0 40.83h93.839c26.63 0 26.63-40.83 0-40.83"
      />
    </svg>
  );
}

export function SQLIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 256 252"
      style={languageIconStyle(0.93)}
    >
      <path d="M0 0h256v252H0z" fill="none" />
      <path
        fill="currentColor"
        d="M236 194c-14 0-25 1-34 5c-3 1-7 1-7 4l3 6c2 3 5 8 9 11l11 8l21 10l11 9l6 4l-3-6l-5-5q-7.5-10.5-18-18c-6-3-18-9-20-15h-1l12-3l18-3l8-2v-2l-9-10c-8-8-18-15-28-22l-18-8c-2-1-6-2-7-4l-7-13l-15-30l-8-20c-18-30-38-48-68-65c-6-4-14-5-22-7l-13-1l-8-6C34 5 8-9 1 9c-5 11 7 22 11 28l9 13l3 9c3 8 5 17 9 24l6 10c2 2 4 3 5 6c-3 4-3 9-4 13c-7 20-4 44 5 59c2 4 9 14 18 10c8-3 6-13 8-22l1-4l8 14c5 9 14 18 22 24c4 3 8 8 13 10l-4-4l-9-10c-8-10-14-21-20-32l-7-17l-3-6c-3 4-7 7-9 12c-3 7-3 17-4 26h-1c-6-1-8-7-10-12c-5-12-6-32-1-46c1-4 6-15 4-19c-1-3-4-5-6-7l-7-12l-10-30l-9-13c-3-5-7-8-10-14c-1-2-2-5 0-7l2-2c2-2 9 0 11 1c6 3 12 5 17 9l8 6h4c6 1 12 0 17 2c9 3 18 7 25 12c23 14 42 35 54 59c3 4 3 8 5 12l12 26c4 8 7 16 12 23c3 4 14 6 18 8l12 4l18 12c2 2 11 7 12 10"
      />
      <path fill="currentColor" d="m58 43l-7 1l6 7l4 9v-1c3-1 4-4 4-8l-2-4z" />
    </svg>
  );
}

export function GoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 512 512"
      style={languageIconStyle(0.906)}
    >
      <path d="M0 0h512v512H0z" fill="none" />
      <path
        fill="currentColor"
        d="m37.435 218.2l7.266-9.271l92.304-.044l-5.943 9.27zm83.718 22.805l3.061-9.27l-116.949.08L0 241.085zm-3.361 22.887l.884-9.27l-53.197.043l-5.163 9.27zm339.301 72.6c-51.18 28.193-121.104 16.253-139.798-44.876c-11.048 21.741-29.087 39.56-50.584 49.721c-50.933 24.075-120.085 3.08-128.979-62.896c-6.513-63.238 44.669-102.314 74.925-112.18c48.085-14.979 95.508 2.622 111.907 46.427l-51.65 13.538c-5.488-15.271-35.313-26.268-58.239-9.693c-36.057 22.247-35.391 78.232 8.173 86.545c22.618 2.9 37.81-8.276 49.2-25.466l-56.087.12l18.021-38.86h84.057c36.406-102.707 178.391-98.21 192.821-5.92c5.129 32.802-6.069 77.264-53.767 103.54M410.447 209.42c-38.861 8.362-48.547 42.69-42.548 64.684c6.383 23.406 31.11 38.754 62.482 24.076c50.28-23.523 37.1-101.032-19.934-88.76"
      />
    </svg>
  );
}

export function RustIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 15 15"
      style={languageIconStyle(0.906)}
    >
      <path d="M0 0h15v15H0z" fill="none" />
      <path
        fill="currentColor"
        d="M7.174.115a.52.52 0 0 1 .652 0l1.178.95l1.483-.357a.516.516 0 0 1 .588.276l.64 1.355l1.494.307c.24.05.411.258.407.498l-.027 1.492l1.211.91a.49.49 0 0 1 .145.621L14.26 7.5l.686 1.333a.49.49 0 0 1-.145.62l-.726.547h-2.478a.506.506 0 0 1-.512-.5a2.47 2.47 0 0 0-.861-1.87c.521-.363.86-.958.86-1.63c0-1.105-.916-2-2.047-2H1.399l-.015-.856a.5.5 0 0 1 .407-.498l1.495-.307l.639-1.355a.516.516 0 0 1 .588-.276l1.483.357z"
      />
      <path
        fill="currentColor"
        d="M.926 5L.2 5.546a.49.49 0 0 0-.145.621L.74 7.5L.055 8.833a.49.49 0 0 0 .145.62L.926 10h2.99V5z"
      />
      <path
        fill="currentColor"
        d="m1.4 11l-.016.856a.5.5 0 0 0 .407.498l1.495.307l.639 1.355c.103.218.35.334.588.276l1.483-.357l1.178.95a.52.52 0 0 0 .652 0l1.178-.95l1.483.357a.516.516 0 0 0 .588-.276l.64-1.355l1.494-.307a.504.504 0 0 0 .407-.498L13.6 11h-2.005c-.848 0-1.536-.672-1.536-1.5S9.372 8 8.524 8H4.94v2h2.048v1zm7.636-4H4.94V5h4.096c.565 0 1.024.448 1.024 1S9.6 7 9.036 7"
      />
    </svg>
  );
}

export function JavaIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      style={languageIconStyle(0.989)}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M10.82 8.427c-.76-1.085-1.046-1.872-1.108-2.445c-.059-.54.073-.97.335-1.383c.283-.447.708-.862 1.248-1.353c.505-.458 1.137-1.003 1.633-1.62L11.37.374c-.416.517-.928.947-1.418 1.391c-.534.485-1.149 1.062-1.593 1.764c-.466.735-.75 1.611-.635 2.67c.112 1.026.588 2.132 1.458 3.375zm1.25-3.03c.284-.684.861-1.37 1.78-2.156l1.3 1.518c-.831.713-1.129 1.153-1.235 1.407c-.104.25-.035.499.035.747c.084.296.223.79.214 1.322c-.012.706-.254 1.452-.832 2.32l-1.664-1.11c.422-.632.492-1.01.496-1.243c.005-.295-.072-.46-.197-.96c-.12-.478-.21-1.097.102-1.845M6.141 10c.47-.314 1.05-.474 1.592-.604L7.266 7.45c-.813.196-1.551.46-2.112.807C4.644 8.573 4 9.136 4 10c0 .726.486 1.306 1.065 1.686a2.5 2.5 0 0 0-.065.572c0 .98.418 1.807 1.143 2.42c-.107.3-.155.634-.14.968c-.777.151-1.536.373-2.17.664c-.432.198-.858.451-1.19.777c-.334.329-.643.804-.643 1.413c0 .427.189.772.374 1.01c.189.242.432.449.684.624c.506.351 1.184.669 1.959.936c1.558.538 3.669.93 5.983.93c3.327 0 5.663-.384 7.19-.782a13 13 0 0 0 1.704-.561c.21-.088.42-.181.616-.297c.01-.006-1.028-1.715-1.024-1.718c-.564.294-1.188.48-1.8.64c-1.349.352-3.513.718-6.686.718c-2.104 0-3.993-.358-5.33-.82c-.532-.184-1.088-.398-1.541-.74c.115-.09.29-.199.538-.312c.558-.256 1.323-.466 2.14-.591q.344.365.814.64c.965.562 2.292.823 3.879.823c1.31 0 2.258-.132 2.898-.274c.356-.078.714-.167 1.042-.328c.003-.002-.881-1.795-.881-1.795q-.291.105-.593.17c-.489.109-1.29.227-2.466.227c-1.413 0-2.336-.24-2.871-.551c-.426-.248-.589-.524-.622-.824c.868.253 1.895.375 3.056.375c1.463 0 2.518-.143 3.228-.297c.386-.083.775-.179 1.134-.346c.02-.01-.857-1.807-.857-1.807a4.4 4.4 0 0 1-.7.198c-.56.121-1.473.252-2.806.252c-1.603 0-2.67-.264-3.302-.623c-.471-.268-.678-.568-.74-.89c1.24.326 2.805.513 4.48.513c1.817 0 3.502-.22 4.783-.598l-.566-1.918c-1.054.311-2.54.516-4.217.516c-1.724 0-3.245-.216-4.302-.542c-.5-.153-.846-.316-1.056-.458m11.448.746c1.213-.11 1.66.188 1.804.342c.149.16.201.408.136.67c-.116.464-.443.914-.973 1.328c-.529.413-1.2.74-1.873.965l.632 1.897c.828-.276 1.718-.698 2.471-1.285c.75-.586 1.424-1.385 1.683-2.42c.185-.74.112-1.741-.614-2.52c-.73-.782-1.909-1.109-3.447-.969z"
      />
    </svg>
  );
}

export function CppIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 128 128"
      style={languageIconStyle(0.913)}
    >
      <path d="M0 0h128v128H0z" fill="none" />
      <path
        fill="currentColor"
        d="M63.443 0c-1.782 0-3.564.39-4.916 1.172L11.594 28.27C8.89 29.828 6.68 33.66 6.68 36.78v54.197c0 1.562.55 3.298 1.441 4.841l-.002.002c.89 1.543 2.123 2.89 3.475 3.672l46.931 27.094c2.703 1.562 7.13 1.562 9.832 0h.002l46.934-27.094c1.352-.78 2.582-2.129 3.473-3.672c.89-1.543 1.441-3.28 1.441-4.843V36.779c0-1.557-.55-3.295-1.441-4.838v-.002c-.891-1.545-2.121-2.893-3.473-3.67L68.359 1.173C67.008.39 65.226 0 63.443 0m.002 26.033c13.465 0 26.02 7.246 32.77 18.91l-16.38 9.479c-3.372-5.836-9.66-9.467-16.39-9.467c-10.432 0-18.922 8.49-18.922 18.924S53.013 82.8 63.445 82.8c6.735 0 13.015-3.625 16.395-9.465l16.375 9.477c-6.746 11.662-19.305 18.91-32.77 18.91c-20.867 0-37.843-16.977-37.843-37.844s16.976-37.844 37.843-37.844v-.002zM92.881 57.57h4.201v4.207h4.203v4.203h-4.203v4.207h-4.201V65.98h-4.207v-4.203h4.207zm15.765 0h4.208v4.207h4.203v4.203h-4.203v4.207h-4.208V65.98h-4.205v-4.203h4.205z"
      />
    </svg>
  );
}

export function CIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      style={languageIconStyle(0.906)}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 14 15"
    >
      <path d="M0 0h14v15H0z" fill="none" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.65191 0C6.44309 0 6.23426.0457031 6.07582.137344L.575859 3.31289C.258984 3.49547 0 3.94453 0 4.31016v6.35124c0 .183.0644532.3865.168867.5673.104297.1808.248555.3389.406992.4305l5.499731 3.1751c.31675.183.83554.183 1.15218 0l5.50033-3.1751c.1584-.0914.3026-.2495.407-.4303.1043-.1808.1688-.3844.1688-.5673V4.31004c0-.18246-.0644-.38613-.1688-.56695-.1044-.18106-.2486-.33926-.407-.43032L7.22801.137461C7.06969.0457031 6.86086 0 6.65191 0Zm.00024 3.05074c1.57793 0 3.04922.84914 3.84025 2.21602L8.57285 6.37758c-.39516-.68391-1.13203-1.10942-1.9207-1.10942-1.2225 0-2.21742.99493-2.21742 2.21766 0 1.22274.99492 2.21731 2.21742 2.21731.78926 0 1.52519-.42481 1.92129-1.10918l1.91896 1.11058c-.79056 1.36667-2.26232 2.21597-3.84025 2.21597-2.44535 0-4.43473-1.98944-4.43473-4.4348 0-2.44535 1.98938-4.43496 4.43473-4.43496Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function CSharpIcon({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 14 15"
      style={languageIconStyle(0.906)}
    >
      <defs>
        <mask id={maskId}>
          <rect width="14" height="15" fill="white" />
          <path
            d="M9.72 6.6h.5l.08-.5h.52l-.08.5h.54l.08-.5h.52l-.08.5h.5v.5h-.58l-.08.5h.51v.5h-.59l-.08.5h-.52l.08-.5h-.54l-.08.5H9.9l.08-.5h-.5v-.5h.58l.08-.5h-.42v-.5Zm.94.5-.08.5h.54l.08-.5Z"
            fill="black"
          />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M6.65191 0C6.44309 0 6.23426.0457031 6.07582.137344L.575859 3.31289C.258984 3.49547 0 3.94453 0 4.31016v6.35124c0 .183.0644532.3865.168867.5673.104297.1808.248555.3389.406992.4305l5.499731 3.1751c.31675.183.83554.183 1.15218 0l5.50033-3.1751c.1584-.0914.3026-.2495.407-.4303.1043-.1808.1688-.3844.1688-.5673V4.31004c0-.18246-.0644-.38613-.1688-.56695-.1044-.18106-.2486-.33926-.407-.43032L7.22801.137461C7.06969.0457031 6.86086 0 6.65191 0Zm.00024 3.05074c1.57793 0 3.04922.84914 3.84025 2.21602L8.57285 6.37758c-.39516-.68391-1.13203-1.10942-1.9207-1.10942-1.2225 0-2.21742.99493-2.21742 2.21766 0 1.22274.99492 2.21731 2.21742 2.21731.78926 0 1.52519-.42481 1.92129-1.10918l1.91896 1.11058c-.79056 1.36667-2.26232 2.21597-3.84025 2.21597-2.44535 0-4.43473-1.98944-4.43473-4.4348 0-2.44535 1.98938-4.43496 4.43473-4.43496Z"
          clipRule="evenodd"
        />
      </g>
    </svg>
  );
}

export function PhpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 20 20"
      style={languageIconStyle(0.906)}
    >
      <path d="M0 0h20v20H0z" fill="none" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M10 12v8A10 10 0 0 1 8.17.17L10 2h5a5 5 0 0 1 5 4.99v9.02A4 4 0 0 1 16 20v-2a2 2 0 1 0 0-4h-4zm5.5-3a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3"
      />
    </svg>
  );
}

export function RubyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      style={languageIconStyle(0.906)}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M20.156.083c3.033.525 3.893 2.598 3.829 4.77L24 4.822L22.635 22.71L4.89 23.926h.016C3.433 23.864.15 23.729 0 19.139l1.645-3l2.819 6.586l.503 1.172l2.805-9.144l-.03.007l.016-.03l9.255 2.956l-1.396-5.431l-.99-3.9l8.82-.569l-.615-.51L16.5 2.114L20.159.073zM5.13 5.073c3.561-3.533 8.157-5.621 9.922-3.84c1.762 1.777-.105 6.105-3.673 9.636c-3.563 3.532-8.103 5.734-9.864 3.957c-1.766-1.777.045-6.217 3.612-9.75z"
      />
    </svg>
  );
}

export function SwiftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 2048 2048"
      style={languageIconStyle(1)}
    >
      <path d="M0 0h2048v2048H0z" fill="none" />
      <path
        fill="currentColor"
        d="M1522 127q82 0 155 31t127 86t85 127t32 155v994q0 83-31 155t-86 127t-127 85t-155 32H528q-83 0-155-31t-127-86t-86-126t-32-156V526q0-83 31-155t86-127t127-85t156-32zm125 1466q5 0 8-9t5-22t2-22t1-12q0-80-31-156t-82-138q11-38 16-78t6-81q0-106-34-208t-92-192t-137-165t-167-128q72 97 116 212t44 237q0 51-9 100t-27 98q-7-5-13-8t-14-8q-48-26-93-60t-90-68q-112-84-217-174T634 521q-5-4-8-10t-6-10t-7-8t-11-4q0 4 17 28t43 60t58 75t58 76t49 62t26 32q33 40 67 78t69 77q-63-35-121-77t-116-85q-81-60-159-123T439 560q17 28 36 53t39 50q64 80 130 158t135 154t143 145t156 133q-65 39-138 57t-148 19q-130 0-254-47t-229-123q57 92 137 170t176 136t201 89t217 33q72 0 141-15t133-49q38-20 75-34t81-14q63 0 102 30t70 83q2 5 5 5"
      />
    </svg>
  );
}

export function DartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      style={languageIconStyle(0.989)}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M23 11.041v7.175h-3.723L6.81 5.75h10.892zM16.2 4.25l-2.698-2.695a1.93 1.93 0 0 0-2.291-.313L5.845 4.25zM4.25 5.844V16.2l-2.693-2.697c-.6-.6-.731-1.553-.315-2.292zm1.5 11.858V6.812l12.466 12.465V23h-7.175z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function SvelteIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 32 32"
      style={languageIconStyle(0.967)}
    >
      <path d="M0 0h32v32H0z" fill="none" />
      <path
        fill="currentColor"
        d="M27.573 4.229a9.733 9.733 0 0 0-13.068-2.802L7.041 6.172a8.48 8.48 0 0 0-3.854 5.734a8.9 8.9 0 0 0 .891 5.776a8.25 8.25 0 0 0-1.266 3.198a9.13 9.13 0 0 0 1.547 6.88a9.78 9.78 0 0 0 13.068 2.828l7.469-4.75a8.5 8.5 0 0 0 3.839-5.734a8.86 8.86 0 0 0-.896-5.755a9.04 9.04 0 0 0-.266-10.12M13.76 28.172a5.91 5.91 0 0 1-6.349-2.359c-.865-1.198-1.182-2.677-.932-4.146l.146-.708l.135-.438l.401.266a9.3 9.3 0 0 0 2.917 1.469l.271.094l-.031.266c-.026.37.083.786.297 1.104c.438.63 1.198.932 1.932.734c.161-.052.318-.104.453-.188l7.438-4.745c.375-.24.615-.599.708-1.026a1.7 1.7 0 0 0-.266-1.255a1.82 1.82 0 0 0-1.932-.708c-.161.057-.333.12-.469.203l-2.813 1.786a5.9 5.9 0 0 1-7.865-1.708a5.46 5.46 0 0 1-.938-4.146a5.16 5.16 0 0 1 2.365-3.469l7.422-4.745a6 6 0 0 1 1.521-.667a5.92 5.92 0 0 1 6.349 2.349a5.5 5.5 0 0 1 .76 4.849l-.135.443l-.385-.266a9.9 9.9 0 0 0-2.932-1.469l-.266-.078l.026-.266a1.83 1.83 0 0 0-.297-1.12a1.785 1.785 0 0 0-1.932-.708a2 2 0 0 0-.453.188l-7.453 4.786c-.375.25-.615.599-.693 1.036c-.078.427.026.896.266 1.24c.427.63 1.203.896 1.922.708a2 2 0 0 0 .464-.188l2.844-1.813a5.3 5.3 0 0 1 1.516-.677a5.89 5.89 0 0 1 6.349 2.359a5.5 5.5 0 0 1 .958 4.13a5.12 5.12 0 0 1-2.333 3.469l-7.438 4.734a6.5 6.5 0 0 1-1.547.677z"
      />
    </svg>
  );
}

export const BINARY_FILE_EXTENSIONS = new Set([
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "dmg",
  "pkg",
  "exe",
  "dll",
  "so",
  "dylib",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "mp3",
  "mp4",
  "mov",
  "wav",
  "webm",
  "avi",
  "mkv",
  "flac",
  "ogg",
  "m4a",
  "psd",
  "ai",
  "sketch",
  "fig",
  "wasm",
  "bin",
  "dat",
  "glb",
  "gltf",
  "fbx",
  "obj",
  "blend",
  "sqlite",
  "db",
  "lock",
  "pyc",
  "class",
  "o",
  "a",
]);

export function isBinaryFileName(name: string) {
  const base =
    name.toLowerCase().split("/").filter(Boolean).at(-1) ?? name.toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return true;
  return BINARY_FILE_EXTENSIONS.has(base.slice(dot + 1));
}

export function fileTreeIconColor(name: string): string {
  const lower = name.toLowerCase();
  const extension = lower.split(".").pop() || "";
  if (isGitFileName(lower)) return "filetree-color-orange";
  if (isEnvFileName(lower)) return "filetree-color-green";
  if (["tsx", "jsx", "go", "dart"].includes(extension))
    return "filetree-color-cyan";
  if (["ts", "css", "cpp", "cxx", "cc", "c", "md"].includes(extension))
    return "filetree-color-blue";
  if (["js", "mjs", "cjs", "json", "yaml", "yml"].includes(extension))
    return "filetree-color-yellow";
  if (["py", "sh", "bash", "zsh", "sql"].includes(extension))
    return "filetree-color-green";
  if (["html", "svelte", "rs", "swift", "java"].includes(extension))
    return "filetree-color-orange";
  if (["rb", "scss", "sass"].includes(extension)) return "filetree-color-pink";
  if (isImageFileName(lower)) return "filetree-color-image";
  if (["svg", "php", "cs"].includes(extension)) return "filetree-color-purple";
  if (isBinaryFileName(lower)) return "filetree-color-muted";
  return "filetree-color-muted";
}

export const IMAGE_FILE_PATTERN =
  /\.(png|jpe?g|jfif|webp|gif|bmp|ico|avif|tiff?|heic|heif|apng)$/i;

export function isImageFileName(name: string) {
  return IMAGE_FILE_PATTERN.test(name);
}

export function isEnvFileName(name: string) {
  const base =
    name.toLowerCase().split("/").filter(Boolean).at(-1) ?? name.toLowerCase();
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".env");
}

export function isGitFileName(name: string) {
  const base =
    name.toLowerCase().split("/").filter(Boolean).at(-1) ?? name.toLowerCase();
  return (
    base === ".gitignore" ||
    base === ".gitattributes" ||
    base === ".gitmodules" ||
    base === ".gitkeep" ||
    base === ".gitconfig" ||
    base === "gitconfig" ||
    base === ".mailmap" ||
    base === "commit_editmsg" ||
    base.endsWith(".gitignore")
  );
}

export function GitIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="24"
      viewBox="0 0 32 32"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h32v32H0z" fill="none" />
      <path
        d="M29.524 14.802L17.202 2.524a1.76 1.76 0 0 0-2.504 0L12.193 5.02L15.4 8.214c.801-.3 1.603 0 2.204.499c.6.599.801 1.398.5 2.196l3.106 3.095c.802-.3 1.603 0 2.204.499c.802.798.802 2.196 0 2.994c-.801.799-2.204.799-3.005 0a2.17 2.17 0 0 1-.501-2.296l-2.905-2.894v7.586c1.102.5 1.502 1.797 1.001 2.895c-.1.2-.2.4-.4.599c-.802.799-2.204.799-3.006 0s-.801-2.196 0-2.995c.2-.2.401-.4.702-.499v-7.686c-.3-.1-.501-.3-.702-.5a2.17 2.17 0 0 1-.5-2.295L10.89 6.218l-8.415 8.484c-.701.7-.701 1.797 0 2.596l12.222 12.178a1.76 1.76 0 0 0 2.504 0l12.222-12.178c.701-.7.701-1.797 0-2.596"
        fill="currentColor"
      />
    </svg>
  );
}

export function EnvFileIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M17 8h-1V6A5 5 0 0 0 6 6v2H5a2.006 2.006 0 0 0-2 2v10a2.006 2.006 0 0 0 2 2h12a2.006 2.006 0 0 0 2-2V10a2.006 2.006 0 0 0-2-2m-9.72 6.59v.752H5.975v.877H7.45V17H5v-4h2.45v.78H5.975v.81ZM7.9 6a3.1 3.1 0 1 1 6.2 0v2H7.9Zm4.268 11h-.974l-1.63-2.467V17H8.59v-4h.974l1.63 2.479V13h.974Zm3.433 0H14.4L13 13h1l1 3l1-3h1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FileIcon({
  name,
  className,
}: {
  name: string;
  className: string;
}) {
  if (isGitFileName(name)) {
    return <GitIcon className={className} />;
  }

  if (isEnvFileName(name)) {
    return <EnvFileIcon className={className} />;
  }

  if (name.endsWith(".rs")) {
    return <RustIcon className={className} />;
  }

  if (name.endsWith(".java")) {
    return <JavaIcon className={className} />;
  }

  if (name.endsWith(".cpp") || name.endsWith(".cxx") || name.endsWith(".cc")) {
    return <CppIcon className={className} />;
  }

  if (name.endsWith(".c")) {
    return <CIcon className={className} />;
  }

  if (name.endsWith(".cs")) {
    return <CSharpIcon className={className} />;
  }

  if (name.endsWith(".php")) {
    return <PhpIcon className={className} />;
  }

  if (name.endsWith(".rb")) {
    return <RubyIcon className={className} />;
  }

  if (name.endsWith(".swift")) {
    return <SwiftIcon className={className} />;
  }

  if (name.endsWith(".dart")) {
    return <DartIcon className={className} />;
  }

  if (name.endsWith(".svelte")) {
    return <SvelteIcon className={className} />;
  }

  if (name.endsWith(".go")) {
    return <GoIcon className={className} />;
  }

  if (name.endsWith(".sql")) {
    return <SQLIcon className={className} />;
  }

  if (name.endsWith(".sh")) {
    return <ShellIcon className={className} />;
  }

  if (name.endsWith(".scss")) {
    return <SassIcon className={className} />;
  }

  if (name.endsWith(".css")) {
    return <CssIcon className={className} />;
  }

  if (name.endsWith(".html")) {
    return <HtmlIcon className={className} />;
  }

  if (name.endsWith(".tsx") || name.endsWith(".jsx")) {
    return <ReactIcon className={className} />;
  }

  if (name.endsWith(".ts")) {
    return <TypeScriptIcon className={className} />;
  }

  if (/\.(?:js|mjs|cjs)$/i.test(name)) {
    return <JavaScriptIcon className={className} />;
  }

  if (name.endsWith(".md")) {
    return <MarkdownIcon className={className} />;
  }

  if (name.endsWith(".py")) {
    return <PythonIcon className={className} />;
  }

  if (name.endsWith(".json")) {
    return <JsonIcon className={className} />;
  }

  if (isImageFileName(name)) {
    return <ImageFileIcon className={className} />;
  }

  if (name.endsWith(".svg")) {
    return <SvgFileIcon className={className} />;
  }

  return <BinaryFileIcon className={className} />;
}

export function ChevronIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
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

export function LoadingSpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
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

export function FolderOpenIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        d="M9.021 2c.306.003.611.019.903.107l.231.083q.342.142.63.378l.113.101c.256.244.45.548.647.845l.574.863.282.411c.051.07.07.086.084.099l.081.053q.045.024.091.039l.128.014c.086.004.233.007.5.007H14.6c1.103 0 1.991-.001 2.709.058.728.06 1.368.185 1.96.487l.175.093a5 5 0 0 1 2.011 2.092l.115.249c.154.363.247.748.308 1.16q.24.074.468.21l.191.13a2.5 2.5 0 0 1 .9 1.297l.039.158c.075.365.042.72-.016 1.043a9 9 0 0 1-.134.597l-.186.7-.89 3.27c-.409 1.502-.678 2.55-1.233 3.354l-.116.157a5 5 0 0 1-1.752 1.432l-.297.135c-.962.397-2.082.378-3.743.378H7.188c-.654 0-1.21.001-1.66-.033-.427-.032-.855-.102-1.25-.288a4 4 0 0 1-.393-.15l-.155-.074a5 5 0 0 1-2.092-2.01l-.093-.175c-.302-.593-.428-1.233-.487-1.961C.999 16.59 1 15.703 1 14.599V9.4c0-1.103-.001-1.991.058-2.709.06-.728.185-1.368.487-1.96l.093-.175A5 5 0 0 1 3.73 2.545l.224-.106c.53-.227 1.1-.33 1.737-.381C6.41 1.999 7.297 2 8.401 2zm-.62 2c-1.137 0-1.93 0-2.547.05-.529.044-.862.12-1.113.228l-.103.05a3 3 0 0 0-1.196 1.104l-.115.206c-.134.263-.227.611-.276 1.216C3 7.471 3 8.264 3 9.4v5.2c0 1.07.002 1.835.044 2.435l.09-.338 1.259-4.62.15-.55c.15-.53.316-.998.61-1.38l.125-.152a3 3 0 0 1 1.106-.788l.226-.08c.405-.12.848-.144 1.334-.148h11.86a2 2 0 0 0-.077-.226l-.054-.115a3 3 0 0 0-1.105-1.196l-.206-.115c-.263-.134-.611-.227-1.216-.276C16.528 7 15.735 7 14.6 7h-1.621a3.6 3.6 0 0 1-.756-.07l-.147-.037a2.5 2.5 0 0 1-.663-.315l-.197-.146c-.236-.194-.419-.439-.591-.692l-.17-.254-.574-.863a12 12 0 0 0-.282-.411l-.084-.099a.5.5 0 0 0-.081-.053l-.091-.039C9.305 4.011 9.247 4 8.716 4z"
        clipRule="evenodd"
        fill="currentColor"
      />
    </svg>
  );
}

export function FolderClosedIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9.924 2.108C9.564 1.998 9.184 2 8.806 2h-.449C7.273 2 6.4 2 5.691 2.058c-.728.06-1.369.185-1.961.487A5 5 0 0 0 1.545 4.73c-.302.593-.428 1.233-.487 1.962C1 7.399 1 8.274 1 9.357v5.286c0 1.084 0 1.958.058 2.666.06.729.185 1.369.487 1.961a5 5 0 0 0 2.185 2.185c.592.302 1.233.428 1.961.487C6.4 22 7.273 22 8.357 22h7.286c1.084 0 1.958 0 2.666-.058.729-.06 1.369-.185 1.961-.487a5 5 0 0 0 2.185-2.185c.302-.592.428-1.232.487-1.961C23 16.6 23 15.727 23 14.643v-2.286c0-1.083 0-1.958-.058-2.665-.06-.73-.185-1.37-.487-1.962a5 5 0 0 0-2.185-2.185c-.592-.302-1.232-.427-1.961-.487C17.6 5 16.727 5 15.643 5h-2.359c-.531 0-.589-.01-.626-.021a.5.5 0 0 1-.173-.093c-.03-.024-.07-.067-.365-.51l-.575-.862-.05-.075c-.21-.314-.42-.631-.71-.87a2.5 2.5 0 0 0-.861-.46Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MarkdownIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        d="M9.357 3C8.273 3 7.4 3 6.691 3.058c-.728.06-1.369.185-1.96.487A5 5 0 0 0 2.544 5.73c-.302.592-.428 1.233-.487 1.961C2 8.4 2 9.273 2 10.357v3.286c0 1.084 0 1.958.058 2.666.06.729.185 1.369.487 1.961a5 5 0 0 0 2.185 2.185c.592.302 1.233.428 1.961.487C7.4 21 8.273 21 9.357 21h5.286c1.084 0 1.958 0 2.666-.058.729-.06 1.369-.185 1.961-.487a5 5 0 0 0 2.185-2.185c.302-.592.428-1.232.487-1.961C22 15.6 22 14.727 22 13.643v-3.286c0-1.084 0-1.958-.058-2.666-.06-.728-.185-1.369-.487-1.96a5 5 0 0 0-2.185-2.186c-.592-.302-1.232-.428-1.961-.487C16.6 3 15.727 3 14.643 3zM5.66 8.06a1 1 0 0 1 1.108.3L8.5 10.438l1.732-2.078A1 1 0 0 1 12 9v6a1 1 0 1 1-2 0v-3.238l-.732.878a1 1 0 0 1-1.536 0L7 11.762V15a1 1 0 1 1-2 0V9a1 1 0 0 1 .66-.94ZM17 9a1 1 0 1 0-2 0v3.783a9 9 0 0 1-.2-.257 1 1 0 0 0-1.6 1.2 11 11 0 0 0 1.875 1.946 1.47 1.47 0 0 0 1.85 0 11 11 0 0 0 1.875-1.946 1 1 0 0 0-1.6-1.2 9 9 0 0 1-.2.257z"
        clipRule="evenodd"
        fill="currentColor"
      />
    </svg>
  );
}

export function JsonIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M8 4C6.343 4 5 5.194 5 6.667v2.666C5 10.806 3.657 12 2 12c1.657 0 3 1.194 3 2.667v2.666C5 18.806 6.343 20 8 20m8-16c1.657 0 3 1.194 3 2.667v2.666C19 10.806 20.343 12 22 12c-1.657 0-3 1.194-3 2.667v2.666C19 18.806 17.657 20 16 20"
        fill="none"
      />
    </svg>
  );
}

export function ImageFileIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M5 21h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2M8.5 7c.83 0 1.5.67 1.5 1.5S9.33 10 8.5 10S7 9.33 7 8.5S7.67 7 8.5 7M5 17.41l3-3l1.29 1.29c.39.39 1.02.39 1.41 0l5.29-5.29l3 3V19h-14v-1.59Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SvgFileIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 6a5 5 0 0 1 5-5h1.2c.857 0 1.439 0 1.889.038.438.035.663.1.819.18a2 2 0 0 1 .874.874c.08.156.145.38.18.819C13 3.361 13 3.943 13 4.8v.039c0 .527 0 .981.03 1.356.033.395.104.789.297 1.167a3 3 0 0 0 1.311 1.311c.378.193.772.264 1.167.296.375.031.83.031 1.356.031h.039c.857 0 1.439 0 1.889.038.438.035.663.1.819.18a2 2 0 0 1 .874.874c.08.156.145.38.18.819l.007.089H3z"
        fill="currentColor"
      />
      <path
        d="M14.664 1.4c.175.422.253.869.292 1.348.044.54.044 1.205.044 2.01V4.8c0 .576 0 .948.024 1.232.022.271.06.372.085.422a1 1 0 0 0 .437.437c.05.025.15.062.422.085.283.023.656.024 1.232.024h.041c.805 0 1.47 0 2.01.044.48.039.926.116 1.348.292A9.02 9.02 0 0 0 14.664 1.4Z"
        fill="currentColor"
      />
      <path
        d="M10.976 13.784a1 1 0 1 0-1.952.432l1.55 7a1 1 0 0 0 .977.784h1.55a1 1 0 0 0 .977-.784l1.55-7a1 1 0 0 0-1.952-.432l-1.35 6.093z"
        fill="currentColor"
      />
      <path
        d="M4.75 13a2.75 2.75 0 1 0 0 5.5h1.5a.75.75 0 0 1 0 1.5H3a1 1 0 1 0 0 2h3.25a2.75 2.75 0 1 0 0-5.5h-1.5a.75.75 0 0 1 0-1.5H7a1 1 0 1 0 0-2z"
        fill="currentColor"
      />
      <path
        d="M18 17.5c0-.782.228-1.448.546-1.894.32-.447.67-.606.954-.606.28 0 .625.155.942.589a1 1 0 0 0 1.616-1.178C21.472 13.608 20.582 13 19.5 13c-1.097 0-1.996.624-2.581 1.444-.587.821-.919 1.905-.919 3.056 0 1.15.332 2.235.919 3.056.585.82 1.484 1.444 2.581 1.444 1.082 0 1.972-.608 2.558-1.411A1 1 0 0 0 22.25 20v-2a1 1 0 0 0-1-1h-.75a1 1 0 0 0-.25 1.968v.67c-.26.263-.526.362-.75.362-.284 0-.635-.16-.954-.606S18 18.282 18 17.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function BinaryFileIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M2 5.75A.75.75 0 0 1 2.75 5h15.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 5.75m0 12a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75M2.75 11a.75.75 0 0 0 0 1.5h18.5a.75.75 0 0 0 0-1.5z"
        fill="currentColor"
      />
    </svg>
  );
}
