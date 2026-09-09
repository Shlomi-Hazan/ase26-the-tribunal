export function HomeHeroArt() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: "block", height: "100%", width: "100%" }}
      viewBox="0 0 940 560"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="hha-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#FFF8EA" />
          <stop offset="42%" stopColor="#F8E8C7" />
          <stop offset="100%" stopColor="#EBD8AF" />
        </linearGradient>
        <radialGradient cx="56%" cy="32%" id="hha-sun" r="54%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.94" />
          <stop offset="35%" stopColor="#F6DCA4" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#F6DCA4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hha-column" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#CDB98E" />
          <stop offset="18%" stopColor="#F7EBD2" />
          <stop offset="50%" stopColor="#FFF9EA" />
          <stop offset="82%" stopColor="#D8C39A" />
          <stop offset="100%" stopColor="#B99D6D" />
        </linearGradient>
        <linearGradient id="hha-gold" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#F0CF85" />
          <stop offset="38%" stopColor="#C78D2A" />
          <stop offset="100%" stopColor="#7D571F" />
        </linearGradient>
        <linearGradient id="hha-floor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#F9EDD2" />
          <stop offset="100%" stopColor="#DFCAA0" />
        </linearGradient>
        <filter id="hha-soft-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="16" floodColor="#8D672C" floodOpacity="0.2" stdDeviation="16" />
        </filter>
      </defs>

      <rect fill="url(#hha-sky)" height="560" width="940" />
      <circle cx="520" cy="160" fill="url(#hha-sun)" r="360" />

      <g opacity="0.28" stroke="#FFFFFF" strokeWidth="5">
        <path d="M522 -20 252 386" />
        <path d="M616 -8 402 404" />
        <path d="M710 0 548 416" />
      </g>

      <g fill="#E8D3A9" opacity="0.45" stroke="#BFA270" strokeWidth="1">
        <path d="M505 252h92v150h-92Z" />
        <path d="M525 252v150M545 252v150M565 252v150" />
        <path d="M610 230h68v172h-68Z" />
        <path d="M626 230v172M644 230v172" />
        <path d="M690 198h84v204h-84Z" />
        <path d="M710 198v204M730 198v204M750 198v204" />
      </g>

      <g opacity="0.98">
        {[42, 162, 790].map((x) => (
          <g key={x}>
            <rect fill="#D6BC88" height="18" rx="2" width="78" x={x - 10} y="82" />
            <rect fill="url(#hha-column)" height="360" rx="8" width="58" x={x} y="100" />
            <path d={`M${x + 12} 116v325M${x + 29} 116v325M${x + 46} 116v325`} stroke="#D2B983" strokeOpacity="0.6" strokeWidth="2" />
            <rect fill="#C8A66B" height="18" rx="2" width="82" x={x - 12} y="454" />
          </g>
        ))}
        {[282, 660].map((x) => (
          <g key={x}>
            <rect fill="#DFC899" height="14" rx="2" width="64" x={x - 8} y="124" />
            <rect fill="url(#hha-column)" height="322" rx="7" width="48" x={x} y="138" />
            <path d={`M${x + 11} 154v286M${x + 24} 154v286M${x + 37} 154v286`} stroke="#D2B983" strokeOpacity="0.48" strokeWidth="1.6" />
            <rect fill="#C8A66B" height="15" rx="2" width="70" x={x - 11} y="454" />
          </g>
        ))}
      </g>

      <path d="M0 398h940v162H0Z" fill="url(#hha-floor)" />
      <path d="M0 398h940" stroke="#C9AA74" strokeWidth="2" />
      <g opacity="0.34" stroke="#B88B42" strokeWidth="1.2">
        <path d="M450 398 228 560M520 398 430 560M590 398 632 560M660 398 836 560" />
        <path d="M0 472h940M0 520h940" />
      </g>

      <g filter="url(#hha-soft-shadow)">
        <path d="M442 382h218l42 42H400Z" fill="#EBD7AF" stroke="#B98F4C" strokeWidth="2" />
        <path d="M482 336h138l28 46H454Z" fill="#F7E9CC" stroke="#B98F4C" strokeWidth="2" />
        <path d="M516 286h70l18 50H498Z" fill="#EAD0A0" stroke="#B98F4C" strokeWidth="2" />
      </g>

      <g fill="none" filter="url(#hha-soft-shadow)" stroke="url(#hha-gold)" strokeLinecap="round" strokeLinejoin="round">
        <path d="M552 112v214" strokeWidth="7" />
        <path d="M478 158h148" strokeWidth="6" />
        <path d="M552 326h-62M552 326h64" strokeWidth="8" />
        <path d="M478 158 430 238" strokeWidth="3" />
        <path d="M478 158 526 238" strokeWidth="3" />
        <path d="M626 158 580 238" strokeWidth="3" />
        <path d="M626 158 674 238" strokeWidth="3" />
        <path d="M424 238h108c-8 27-25 41-54 41s-46-14-54-41Z" fill="#D8A64B" fillOpacity="0.42" strokeWidth="4" />
        <path d="M574 238h108c-8 27-25 41-54 41s-46-14-54-41Z" fill="#D8A64B" fillOpacity="0.42" strokeWidth="4" />
      </g>
      <circle cx="552" cy="102" fill="#EED086" r="12" stroke="#8A6124" strokeWidth="2" />

      <g opacity="0.82">
        <path d="M330 134h76l20 28v168l-48-30-48 30Z" fill="#27303B" stroke="#C5984E" strokeWidth="2" />
        <path d="M348 166c22-18 44-18 66 0" fill="none" stroke="#C5984E" strokeWidth="2" />
        <text fill="#D6A95A" fontFamily="Georgia, serif" fontSize="19" letterSpacing="0" textAnchor="middle" x="378" y="210">
          REASON
        </text>
        <text fill="#D6A95A" fontFamily="Georgia, serif" fontSize="17" letterSpacing="0" textAnchor="middle" x="378" y="238">
          NOT
        </text>
        <text fill="#D6A95A" fontFamily="Georgia, serif" fontSize="17" letterSpacing="0" textAnchor="middle" x="378" y="265">
          NOISE
        </text>
      </g>

      <g opacity="0.82" transform="translate(760 388)">
        <rect fill="#202026" height="22" rx="4" stroke="#B7893E" width="120" x="0" y="0" />
        <rect fill="#2C241E" height="22" rx="4" stroke="#B7893E" width="130" x="-12" y="22" />
        <rect fill="#161B22" height="22" rx="4" stroke="#B7893E" width="116" x="5" y="44" />
        <path d="M98 0v66" stroke="#B7893E" strokeWidth="1" />
      </g>
    </svg>
  );
}
