// Milestone 14 (Ivory & Iron, Issue #39 Phase 2/§4) -- the Home hero's
// art slot. This is an explicit, ORIGINAL placeholder (simple geometric
// line-work: an arch, a column, a scales-of-justice motif, warm ivory/
// gold gradient) -- NOT the final bespoke commissioned illustration the
// approved design calls for, and NOT stock photography. It exists so the
// production hero layout (aspect ratio, crop behavior, scrim,
// width/height reservation against layout shift) can be built and
// verified now; swapping in the final artwork later requires no layout
// change, only replacing this component's internals (or the image it
// renders) -- see the implementation PR notes for the exact asset
// dimensions the final commission should target.
export function HomeHeroArt() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 640 480"
      style={{ display: "block", height: "100%", width: "100%" }}
    >
      <defs>
        <linearGradient id="hero-ground" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#F1EAD9" />
          <stop offset="100%" stopColor="#E9DEC2" />
        </linearGradient>
        <linearGradient id="hero-glow" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#F6E9C9" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#F6E9C9" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect fill="url(#hero-ground)" height="480" width="640" />
      <circle cx="460" cy="150" fill="url(#hero-glow)" r="220" />
      {/* A restrained row of columns -- the "classical institution" cue,
         rendered as simple linework rather than a photograph. */}
      <g fill="none" stroke="#B8892B" strokeOpacity="0.35" strokeWidth="3">
        <line x1="360" x2="360" y1="140" y2="420" />
        <line x1="420" x2="420" y1="140" y2="420" />
        <line x1="480" x2="480" y1="140" y2="420" />
        <line x1="540" x2="540" y1="140" y2="420" />
        <path d="M340 140 L560 140 L550 110 L350 110 Z" />
      </g>
      {/* Scales of justice, simplified to clean geometry. */}
      <g fill="none" stroke="#8C6423" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
        <line x1="230" x2="230" y1="120" y2="330" />
        <line x1="150" x2="310" y1="150" y2="150" />
        <path d="M150 150 L120 220 A34 34 0 0 0 180 220 Z" />
        <path d="M310 150 L280 220 A34 34 0 0 0 340 220 Z" />
        <line x1="190" x2="270" y1="330" y2="330" />
      </g>
    </svg>
  );
}
