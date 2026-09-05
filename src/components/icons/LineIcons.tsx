// Milestone 14 (Ivory & Iron, PR #40 visual correction pass) -- a small,
// original, consistent set of stroke-only line icons. Hand-authored
// simple geometry (no icon-pack dependency is installed -- see the
// note in RunPage.tsx's chevron comment), 24x24 viewBox, currentColor
// stroke so every icon inherits its surrounding text/accent color.
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width={size}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 12.5h6M9 15.5h6M9 9.5h2" />
    </Icon>
  );
}

export function ClockHistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12.5" r="8" />
      <path d="M12 8v5l3.2 1.8" />
      <path d="M6 3.5 4 5.8M18 3.5l2 2.3" />
    </Icon>
  );
}

export function PortraitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="9" r="3.6" />
      <path d="M5 20c1-3.6 4-5.5 7-5.5s6 1.9 7 5.5" />
    </Icon>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v16M7.5 19.5h9" />
      <path d="M4 7.5h7M13 7.5h7" />
      <path d="M4 7.5 1.8 12.3a2.6 2.6 0 0 0 4.9 1.6L4 7.5ZM20 7.5l-2.2 4.8a2.6 2.6 0 0 0 4.9 1.6L20 7.5Z" />
    </Icon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.5" cy="8.5" r="3" />
      <path d="M2.5 19c.8-3.1 3.2-4.8 6-4.8s5.2 1.7 6 4.8" />
      <circle cx="16.5" cy="8" r="2.3" />
      <path d="M15 14.6c2.6.3 4.4 1.9 5 4.4" />
    </Icon>
  );
}

export function BarChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 19V12M11 19V5M17 19v-8.5" />
      <path d="M3.5 19h17" />
    </Icon>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6" />
    </Icon>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4v-10Z" />
      <path d="M7.5 9h9M7.5 12h6" />
    </Icon>
  );
}

export function GavelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 4 6.5 6.5M6.2 6.8l6.5 6.5M4 19h9" />
      <path d="m5 15 5-5 3 3-5 5-3-3ZM15 6l3-3 3 3-3 3-3-3Z" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}
