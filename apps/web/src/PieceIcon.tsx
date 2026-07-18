import type { PieceType } from "@chess-coach/chess-core";
import type { PlayerColor } from "@chess-coach/chess-core";
import type { ReactNode } from "react";

interface PieceIconProps {
  readonly color: PlayerColor;
  readonly type: PieceType;
  readonly className?: string;
}

const paths: Record<PieceType, ReactNode> = {
  p: (
    <>
      <circle cx="32" cy="17" r="8" />
      <path d="M22 28c0-4 4-7 10-7s10 3 10 7c0 5-3 8-6 11l4 11h-16l4-11c-3-3-6-6-6-11Z" />
      <path d="M16 53h32v5H16z" />
    </>
  ),
  n: (
    <path d="M18 57h30v-5H40c4-8 8-13 5-25-2-8-8-13-17-16l3 10c-6 3-10 9-10 17 0 6 2 10 5 14h-8v5Zm10-29c3 1 6 3 8 6-5-1-9 0-12 3 0-4 1-7 4-9Z" />
  ),
  b: (
    <>
      <path d="M32 8c-5 5-8 10-8 15 0 4 2 8 5 11-5 4-8 8-8 13h22c0-5-3-9-8-13 3-3 5-7 5-11 0-5-3-10-8-15Z" />
      <path d="m24 22 16 17M18 53h28v5H18z" />
    </>
  ),
  r: (
    <>
      <path d="M16 8h8v7h5V8h6v7h5V8h8v13l-5 5v20H21V26l-5-5V8Z" />
      <path d="M18 46h28v7H18zM14 57h36v4H14z" />
    </>
  ),
  q: (
    <>
      <path d="m13 14 8 8 11-14 11 14 8-8-4 25H17l-4-25Z" />
      <path d="M17 44h30v7H17zM13 57h38v4H13z" />
    </>
  ),
  k: (
    <>
      <path d="M28 7h8v8h8v7h-8v8c0 4 3 8 7 12H21c4-4 7-8 7-12v-8h-8v-7h8V7Z" />
      <path d="M18 44h28v7H18zM13 57h38v4H13z" />
    </>
  ),
};

export function PieceIcon({ color, type, className }: PieceIconProps) {
  return (
    <svg
      className={`piece-icon piece-icon-${color}${className ? ` ${className}` : ""}`}
      viewBox="0 0 64 64"
      focusable="false"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
        {paths[type]}
      </g>
    </svg>
  );
}
