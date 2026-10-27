/** Lattice status orb — S2 diagonal “processing” wave. */
import type { CSSProperties } from "react";
import styles from "./Orb.module.css";

/** The stage the geometry is tuned on; --orb-k scales it to `size`. */
const STAGE = 28;

/** Default rendered size — 20×20 indicator box. */
const SIZE = 20;

export type LatticeVariant = "S2";
export type OrbVariant = LatticeVariant;

export const ORB_TASKS: Record<OrbVariant, string> = {
  S2: "Processing",
};

const N = 3; // lattice is N×N
const PITCH = 6; // centre-to-centre spacing in stage px
const MID = (N - 1) / 2;

/**
 * Per-cell `animation-delay` in ms. S2: a broad band crosses the grid on the
 * diagonal so the sweep stays continuous.
 */
function cellDelay(_v: LatticeVariant, x: number, y: number): number {
  return ((x + y) / (2 * (N - 1))) * 1500;
}

/**
 * `settle` gathers each cell from a position rotated one way around the
 * centre and releases it to the mirror rotation.
 */
const SWIRL = 1.05; // radians ~60°
const SPREAD = 1.6;

/** Offset from a cell's grid slot to its swirled position, in stage px. */
function swirl(x: number, y: number, angle: number): [number, number] {
  const dx = x - MID;
  const dy = y - MID;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    ((dx * cos - dy * sin) * SPREAD - dx) * PITCH,
    ((dx * sin + dy * cos) * SPREAD - dy) * PITCH,
  ];
}

interface Cell {
  key: string;
  left: number;
  top: number;
  delay: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  mid: boolean;
}

/** The 9 lattice cells with position, phase and swirl vectors. */
function latticeCells(v: LatticeVariant): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [ax, ay] = swirl(x, y, -SWIRL);
      const [bx, by] = swirl(x, y, SWIRL);
      cells.push({
        key: `${x},${y}`,
        left: x * PITCH,
        top: y * PITCH,
        delay: cellDelay(v, x, y),
        ax,
        ay,
        bx,
        by,
        mid: x === MID && y === MID,
      });
    }
  }
  return cells;
}

export interface OrbProps {
  variant?: OrbVariant;
  /** Rendered edge length in px. The 28px geometry scales to fit. */
  size?: number;
  /** Accessible label, and the status text when `pill` is set. */
  label?: string;
  /** Wraps the orb and its label in a status pill. */
  pill?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Orb({
  variant = "S2",
  size = SIZE,
  label,
  pill,
  className,
  style,
}: OrbProps) {
  const text = label ?? `${ORB_TASKS[variant]}…`;
  return (
    <span
      className={styles.root + (className ? ` ${className}` : "")}
      data-pill={pill ? "" : undefined}
      style={style}
    >
      <span
        className={styles.glyph}
        role={pill ? undefined : "img"}
        aria-label={pill ? undefined : text}
        aria-hidden={pill ? true : undefined}
        style={
          {
            width: size,
            height: size,
            "--orb-k": size / STAGE,
          } as CSSProperties
        }
      >
        <span className={styles.lattice} data-variant={variant}>
          {latticeCells(variant).map((c) => (
            <span
              key={c.key}
              className={styles.cell}
              data-mid={c.mid ? "" : undefined}
              style={
                {
                  "--cell-x": `${c.left}px`,
                  "--cell-y": `${c.top}px`,
                  animationDelay: `${c.delay}ms`,
                  "--orb-ax": `${c.ax}px`,
                  "--orb-ay": `${c.ay}px`,
                  "--orb-bx": `${c.bx}px`,
                  "--orb-by": `${c.by}px`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      </span>
      {pill ? <span className={styles.pillLabel}>{text}</span> : null}
    </span>
  );
}
