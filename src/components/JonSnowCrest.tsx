// Milestone 14 (Ivory & Iron, Issue #39 Phase 2/4) -- an ORIGINAL,
// simple crest motif for the Jon Snow demo's dark surfaces (Home card,
// Settings, themed run banner). Deliberately abstract geometry -- a
// shield outline, a stylized wolf-head silhouette, a north star -- never
// a copy of any real house sigil, never an official franchise asset.
export function JonSnowCrest({ size = 40 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height={size}
      viewBox="0 0 48 48"
      width={size}
    >
      <path
        d="M24 4 L42 11 V24 C42 34 34 41 24 45 C14 41 6 34 6 24 V11 Z"
        fill="none"
        stroke="#A98548"
        strokeWidth="1.5"
      />
      {/* Stylized wolf-head silhouette -- simple triangles/curves only. */}
      <path
        d="M24 15 L31 26 L27 26 L27 32 L21 32 L21 26 L17 26 Z"
        fill="#A98548"
        fillOpacity="0.85"
      />
      <circle cx="24" cy="9" fill="#D8DEE6" r="1.6" />
    </svg>
  );
}
