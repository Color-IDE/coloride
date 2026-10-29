import type { ReactNode } from "react";

function Mark({
  children,
  viewBox,
}: {
  children: ReactNode;
  viewBox: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className="acp-agent-mark"
      fill="none"
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function KimiMark() {
  return (
    <Mark viewBox="1 2 126 124">
      <path
        d="M116.013 25.756C107.735 14.603 95.777 6.061 81.32 2.189a63.53 63.53 0 0 0-41.831 3.065zM12.199 27.698A63.84 63.84 0 0 1 33.896 8.006L90.27 23.112c-3.699 2.134-7.663 5.812-10.73 9.854l46.352 12.42a63.6 63.6 0 0 1 2.532 13.455L12.199 27.699ZM126.428 80.32a64 64 0 0 1-2.354 7.111L1.672 54.635a64 64 0 0 1 1.516-7.336a63.7 63.7 0 0 1 6.696-15.968l59.898 16.05a80 80 0 0 0-6.504 11.137l64.201 17.204a66 66 0 0 1-1.055 4.603l.003-.005ZM4.704 85.203A63.4 63.4 0 0 1 1.205 58.76l56.489 15.136a89 89 0 0 0-2.906 11.944l60.999 16.344a63.5 63.5 0 0 1-9.626 10.203L4.704 85.202Zm43.592 40.225c-19.256-5.161-34.081-18.596-41.672-35.457l45.968 12.318a77 77 0 0 0 .777 12.472l33.4 8.948c-11.922 4.383-25.268 5.257-38.473 1.719"
        fill="currentColor"
      />
    </Mark>
  );
}

export function MiniMaxMark() {
  return (
    <Mark viewBox="0 1.9 24 20.2">
      <path
        d="M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997"
        fill="currentColor"
      />
    </Mark>
  );
}

export function MistralMark() {
  return (
    <Mark viewBox="64 192 896 640">
      <path
        d="M704.005 192.016v127.979H575.99V448.01H448.011V319.995H319.995V192.053H192.053v511.99H64V832.02h384.01V704.043H319.996V576.027H448.01v128.016h128.016V576.027h127.978v128.016H576.027V832.02H960V704.043H831.947V192.016z"
        fill="currentColor"
      />
    </Mark>
  );
}

export function CodexMark() {
  return (
    <Mark viewBox="0 0 128 128">
      <path
        d="M43.125 2.437A32.56 32.56 0 0 1 59.37.224q10.664 1.225 19.008 9.067a.62.62 0 0 0 .571.155q11.265-2.768 21.659 1.952l.336.16l.821.405c7.237 3.749 12.427 9.44 15.563 17.056a30 30 0 0 1 2.245 11.339a30.2 30.2 0 0 1-.96 8.699a.89.89 0 0 0 .213.827a31.9 31.9 0 0 1 8.416 15.419c2.053 10.139-.053 19.28-6.309 27.413l-.971 1.173a32.34 32.34 0 0 1-15.648 9.872a.86.86 0 0 0-.576.544c-1.36 3.925-2.725 7.275-5.264 10.624c-6.395 8.437-15.797 13.131-26.389 13.072q-12.663-.066-22.453-9.259a.77.77 0 0 0-.747-.171c-2.763.891-5.547 1.019-8.555.987a31.6 31.6 0 0 1-13.84-3.317a32.3 32.3 0 0 1-11.445-9.499c-1.083-1.435-2.155-2.784-2.939-4.379a41.3 41.3 0 0 1-2.64-6.843a32.6 32.6 0 0 1-.091-16.341a.9.9 0 0 0 .043-.395a.6.6 0 0 0-.197-.341a31.8 31.8 0 0 1-7.36-11.744a27.7 27.7 0 0 1-1.776-8.475a36.9 36.9 0 0 1 1.003-11.371q3.6-11.871 13.744-18.629c1.504-1.003 2.933-1.781 4.277-2.336a43 43 0 0 1 4.592-1.621a.69.69 0 0 0 .464-.464a32.1 32.1 0 0 1 5.888-11.483q5.44-6.77 13.072-9.883m-4.288 41.867a4.523 4.523 0 0 0-7.856 4.491l9.035 15.813l-9.003 15.189a4.528 4.528 0 0 0 7.787 4.608l10.347-17.451a4.53 4.53 0 0 0 .037-4.555zm29.045 33.28a4.528 4.528 0 0 0 0 9.04h25.856a4.528 4.528 0 0 0 0-9.045H67.882z"
        fill="currentColor"
      />
    </Mark>
  );
}

export function OpenCodeMark() {
  return (
    <Mark viewBox="2 0 20 24">
      <path d="M22 24H2V0h20zM17 4.8H7v14.4h10z" fill="currentColor" />
    </Mark>
  );
}

const MARKS: Record<string, () => ReactNode> = {
  "codex-acp": CodexMark,
  kimi: KimiMark,
  "minimax-code": MiniMaxMark,
  "mistral-vibe": MistralMark,
  opencode: OpenCodeMark,
};

export function AgentMark({
  agentId,
  icon,
  name,
}: {
  agentId: string;
  icon?: string | null;
  name?: string;
}) {
  const MarkForAgent = MARKS[agentId];
  if (MarkForAgent) return <MarkForAgent />;
  if (icon) {
    return (
      <img
        alt=""
        className="acp-agent-mark"
        height={14}
        loading="lazy"
        src={icon}
        width={14}
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }
  return (
    <span className="acp-agent-mark acp-agent-mark-fallback" aria-hidden="true">
      {(name || agentId).charAt(0)}
    </span>
  );
}
