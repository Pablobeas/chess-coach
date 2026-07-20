import type { PieceType, PlayerColor } from "@chess-coach/chess-core";
import { useId, type ReactNode } from "react";

interface PieceIconProps {
  readonly color: PlayerColor;
  readonly type: PieceType;
  readonly className?: string;
}

type PieceShape = (fillId: string) => ReactNode;

const fill = (id: string) => `url(#${id})`;

/** Original, deliberately broad silhouettes; no third-party asset geometry is used. */
const shapes: Record<PieceType, PieceShape> = {
  p: (fillId) => (
    <>
      <circle cx="32" cy="15.8" r="7.4" fill={fill(fillId)} />
      <path
        fill={fill(fillId)}
        d="M24.4 31c.9-4.8 3.6-7.3 7.6-7.3s6.7 2.5 7.6 7.3c.7 3.8-.6 6.7-3.9 9.3l2.7 8.1H25.6l2.7-8.1c-3.3-2.6-4.6-5.5-3.9-9.3Z"
      />
      <path
        fill={fill(fillId)}
        d="M21 48.4h22l2.3 4.7H18.7l2.3-4.7ZM16 53.1h32l2.8 5.2H13.2l2.8-5.2Z"
      />
      <path className="piece-detail" d="M25.6 48.4h12.8M21 53.1h22" />
    </>
  ),
  n: (fillId) => (
    <g data-classic-profile="horse">
      <path
        fill={fill(fillId)}
        d="M18.4 58.2h32.8l-3.1-6.1h-9.3c4.8-7 7-14 5.8-21.2-1.2-7.4-5.8-13.5-13.4-17.2l1.2 8.1-7.7 5.6-7.6 1.5 2.8 6.6 8.7-1.9c-3.4 6.2-3 12.3 1.6 18.5h-8.7l-3.1 6.1Z"
      />
      <path fill={fill(fillId)} d="M21.5 52.1h26.6l3.1 6.1H18.4l3.1-6.1Z" />
      <path
        className="piece-detail"
        d="M32.4 21.8c5.3 2.2 8.2 6.1 8.9 11.7-3.6-2.6-7.9-2.7-12.7.1M25.2 52.1h18.9"
      />
      <circle cx="29.3" cy="27.1" r="1.25" fill="currentColor" stroke="none" />
    </g>
  ),
  b: (fillId) => (
    <>
      <path
        fill={fill(fillId)}
        d="M32 8.6c-5.4 5.7-8 10.4-8 14.3 0 4.2 2 7.8 5.6 10.7-4.4 3.7-7.2 8.6-7.5 14.7h19.8c-.3-6.1-3.1-11-7.5-14.7 3.6-2.9 5.6-6.5 5.6-10.7 0-3.9-2.6-8.6-8-14.3Z"
      />
      <path
        fill={fill(fillId)}
        d="M20.1 48.3h23.8l2.6 4.8H17.5l2.6-4.8ZM15.8 53.1h32.4l2.6 5.2H13.2l2.6-5.2Z"
      />
      <path
        className="piece-detail"
        d="m25.9 20.8 12.4 12.4M22 48.3h20M20.1 53.1h23.8"
      />
    </>
  ),
  r: (fillId) => (
    <>
      <path
        fill={fill(fillId)}
        d="M14.7 9h8v5.8h4V9h10.6v5.8h4V9h8v12.5l-4.7 4.7v20.2H19.4V26.2l-4.7-4.7V9Z"
      />
      <path
        fill={fill(fillId)}
        d="M18.3 46.4h27.4v6.1H18.3v-6.1ZM14.5 52.5h35l2.7 5.6H11.8l2.7-5.6Z"
      />
      <path
        className="piece-detail"
        d="M19.4 26.2h25.2M18.3 46.4h27.4M14.5 52.5h35"
      />
    </>
  ),
  q: (fillId) => (
    <>
      <path
        fill={fill(fillId)}
        d="m12.6 17 8.1 5.3L27.8 10l4.2 11.6L36.2 10l7.1 12.3 8.1-5.3-4.5 25.7H17.1L12.6 17Z"
      />
      <path
        fill={fill(fillId)}
        d="M17.1 42.7h29.8v6.4H17.1v-6.4ZM13.7 49.1h36.6l2.7 5.3H11l2.7-5.3ZM11 54.4h42l2.4 4H8.6l2.4-4Z"
      />
      <circle cx="12.6" cy="17" r="2.3" fill={fill(fillId)} />
      <circle cx="27.8" cy="10" r="2.3" fill={fill(fillId)} />
      <circle cx="36.2" cy="10" r="2.3" fill={fill(fillId)} />
      <circle cx="51.4" cy="17" r="2.3" fill={fill(fillId)} />
      <path
        className="piece-detail"
        d="M17.1 42.7h29.8M13.7 49.1h36.6M11 54.4h42"
      />
    </>
  ),
  k: (fillId) => (
    <g data-classic-profile="crowned-king">
      <path
        fill={fill(fillId)}
        d="M28.4 6.5h7.2v7.1h7.1v6.5h-7.1v5h-7.2v-5h-7.1v-6.5h7.1V6.5Z"
      />
      <path
        fill={fill(fillId)}
        d="M32 23.8c-7.9 0-13.2 4.6-13.2 10.5 0 4.3 2.9 7.7 7.4 10.1h11.6c4.5-2.4 7.4-5.8 7.4-10.1 0-5.9-5.3-10.5-13.2-10.5ZM18.2 44.4h27.6v6.4H18.2v-6.4ZM13.2 50.8h37.6l2.8 7.4H10.4l2.8-7.4Z"
      />
      <path
        className="piece-detail"
        d="M21.3 20.1h21.4M22.6 40.9h18.8M18.2 44.4h27.6M13.2 50.8h37.6"
      />
    </g>
  ),
};

const gradients = {
  white: ["#FFFFFF", "#FAFAFA", "#D6D6D2"],
  black: ["#767671", "#484743", "#2F302E"],
} as const;

export function PieceIcon({ color, type, className }: PieceIconProps) {
  const instanceId = useId().replaceAll(":", "");
  const gradientId = `piece-fill-${color}-${instanceId}`;

  return (
    <svg
      className={`piece-icon piece-icon-${color}${className ? ` ${className}` : ""}`}
      viewBox="0 0 64 64"
      focusable="false"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="19"
          x2="45"
          y1="8"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={gradients[color][0]} />
          <stop offset="0.55" stopColor={gradients[color][1]} />
          <stop offset="1" stopColor={gradients[color][2]} />
        </linearGradient>
      </defs>
      <g
        data-piece-type={type}
        data-piece-silhouette="neo-original"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {shapes[type](gradientId)}
      </g>
    </svg>
  );
}
