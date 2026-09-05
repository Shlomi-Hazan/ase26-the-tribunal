// Milestone 14 (Ivory & Iron, Issue #39 Phase 2; PR #40 visual
// correction pass) -- an ORIGINAL illustrated hero scene: a sunlit
// colonnade with a golden scale of justice at its center, evoking the
// approved reference direction (a bright, warm, premium courtroom
// mood) without any photographic or stock imagery. This remains a
// deliberately illustrated placeholder -- not the final bespoke
// commissioned artwork -- but is now composed with real depth
// (layered columns, a soft light glow, a floor line) rather than a
// single flat line icon, so the hero reads as premium in the interim.
export function HomeHeroArt() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 640 480"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient cx="50%" cy="38%" id="hha-glow" r="60%">
          <stop offset="0%" stopColor="#F6E3B8" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#EFD6A0" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#EFD6A0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hha-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#FBF2DC" />
          <stop offset="100%" stopColor="#F1E0BC" />
        </linearGradient>
        <linearGradient id="hha-gold" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#E8BE73" />
          <stop offset="100%" stopColor="#9A6E28" />
        </linearGradient>
        <linearGradient id="hha-column" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#EADFC4" />
          <stop offset="100%" stopColor="#D8C79E" />
        </linearGradient>
      </defs>

      <rect fill="url(#hha-sky)" height="480" width="640" />
      <circle cx="320" cy="182" fill="url(#hha-glow)" r="240" />

      {/* Light rays, faint */}
      <g opacity="0.35" stroke="#E8BE73" strokeWidth="2">
        <path d="M320 40v70" />
        <path d="M232 62l28 62" />
        <path d="M408 62l-28 62" />
      </g>

      {/* Receding colonnade, three columns per side for depth */}
      <g fill="url(#hha-column)" stroke="#C9B583" strokeWidth="1.5">
        <rect height="300" rx="3" width="18" x="70" y="170" />
        <rect height="300" rx="3" width="26" x="140" y="150" />
        <rect height="300" rx="3" width="34" x="220" y="126" />
        <rect height="300" rx="3" width="34" x="386" y="126" />
        <rect height="300" rx="3" width="26" x="474" y="150" />
        <rect height="300" rx="3" width="18" x="552" y="170" />
      </g>
      {/* Column capitals */}
      <g fill="#DFCB9E" stroke="#C9B583" strokeWidth="1.5">
        <rect height="10" width="30" x="64" y="162" />
        <rect height="12" width="40" x="134" y="140" />
        <rect height="14" width="50" x="212" y="114" />
        <rect height="14" width="50" x="378" y="114" />
        <rect height="12" width="40" x="470" y="140" />
        <rect height="10" width="30" x="546" y="162" />
      </g>

      {/* Floor */}
      <path d="M0 440h640v40H0Z" fill="#E9DBB8" />
      <path d="M0 440h640" stroke="#CBB786" strokeWidth="2" />

      {/* Scale of justice, centered focal element */}
      <g fill="none" stroke="url(#hha-gold)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6">
        <path d="M320 120v220" />
        <path d="M258 168h124" />
        <path d="M320 340h-56M320 340h56" />
        <path d="M258 168 216 232a40 40 0 0 0 76 0L258 168ZM382 168l-42 64a40 40 0 0 0 76 0l-34-64Z" />
      </g>
      <circle cx="320" cy="112" fill="#E8BE73" r="9" stroke="#9A6E28" strokeWidth="2" />
    </svg>
  );
}
