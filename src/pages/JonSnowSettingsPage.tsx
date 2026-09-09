// Milestone 12 (human product override, PR #34 Sec 16-18) -- `/demo/
// jon-snow` is redefined from a BYOK-gated launcher into the "Modify
// settings / models" detail page. The demo is operator-funded
// (SECURITY.md Sec 3.1.1): there is no OpenRouter credential field or
// OpenRouterConnect on this page at all. Only the SHARED model may be
// customized, restricted to models that are both currently eligible AND
// within the operator-funded demo's own cost ceiling
// (JON_SNOW_DEMO_MAX_ESTIMATE_USD) -- an expensive model is omitted from
// the list entirely rather than shown disabled.
//
// Milestone 14 cinematic redesign pass (PR #40) -- one cohesive
// full-width narrative built from the approved local artwork under
// src/assets/jon-snow-demo/. Every hook, state value, and the model
// select/Run button's own logic is byte-identical to before; only their
// position and surrounding styling changed.
//
// Milestone 14 visual REFINEMENT pass (PR #40, human review round 2) --
// four corrections on top of that same base, still presentation-only:
// (1) Run Configuration moves into the hero itself (right column) so the
// model selector and Run action sit above the fold with no/minimal
// scroll -- there is still exactly ONE selector and ONE Run button, now
// simply positioned earlier; the bottom-of-page duplicate is removed.
// (2) Advocates AND Judges both become horizontal "persona dossier"
// cards (portrait on the left, identity + the participant's own
// canonical `.personality` string on the right, rendered in full,
// never summarized/truncated/line-clamped) -- Judges reuse three new
// portrait assets and the exact same card component as Advocates, so
// both panels read with equal weight. (3) The page breaks out of the
// app shell's centered `lg` Container locally (this route only, via a
// self-contained CSS "full-bleed" wrapper -- AppShell.tsx itself is
// untouched) to use ~94% of the viewport up to a 1640px cap, instead of
// the shell's narrower ~1136px content column. (4) A purely decorative,
// deterministic (never `Math.random()` at render) CSS snow layer sits
// fixed behind all content, respecting the app's existing global
// `prefers-reduced-motion` rule (jonSnowTheme.ts's MuiCssBaseline
// override already clamps every CSS animation's duration under reduced
// motion -- no additional code was needed for that here).
import { Alert, Box, Divider, MenuItem, Stack, TextField, Typography } from "@mui/material";
import Button from "@mui/material/Button";
import Decimal from "decimal.js";
import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import darkPanelTextureUrl from "../assets/jon-snow-demo/dark-panel-texture.png";
import heroFortressUrl from "../assets/jon-snow-demo/hero-fortress.png";
import northernWolfBannerUrl from "../assets/jon-snow-demo/northern-wolf-banner.png";
import northernWolfCrestUrl from "../assets/jon-snow-demo/northern-wolf-crest.png";
import portraitJudgeAharonBarakUrl from "../assets/jon-snow-demo/portrait-judge-aharon-barak.png";
import portraitJudgeMeirShamgarUrl from "../assets/jon-snow-demo/portrait-judge-meir-shamgar.png";
import portraitJudgeMenachemElonUrl from "../assets/jon-snow-demo/portrait-judge-menachem-elon.png";
import portraitMilitaryCommanderUrl from "../assets/jon-snow-demo/portrait-military-commander.png";
import portraitNorthernWarriorUrl from "../assets/jon-snow-demo/portrait-northern-warrior.png";
import portraitRoyalAdviserUrl from "../assets/jon-snow-demo/portrait-royal-adviser.png";
import portraitSilverQueenUrl from "../assets/jon-snow-demo/portrait-silver-queen.png";
import { ScaleIcon } from "../components/icons/LineIcons";
import { useEligibleModels } from "../features/case-setup/useEligibleModels";
import {
  JON_SNOW_CHARGE_SHEET,
  JON_SNOW_DOSSIER_DISCLAIMER,
  JON_SNOW_PARTICIPANTS,
  JON_SNOW_PRESET_VERSION
} from "../features/jon-snow-demo/canonicalPreset";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { JON_SNOW_DEMO_MAX_ESTIMATE_USD } from "../features/jon-snow-demo/jonSnowDemoEconomics";
import { useJonSnowDemoStart } from "../features/tribunal-run/useJonSnowDemoStart";
import { hasJonSnowDemoAccess } from "../services/jonSnowDemoAccess";
import { monoFontStack } from "../theme/theme";
import type { ParticipantId } from "../schemas/tribunalSetup";
import type { EligibleModel } from "../services/modelsApi";

const displayFont = '"Fraunces", Georgia, serif';

// Same dark-chamber palette jonSnowTheme.ts already assigns to this
// route (night/frost/steel/ironBorder/direBronze/valyrianBlue) --
// repeated as local literals here, matching this file's own
// pre-existing convention. proAccent/conAccent are procedural-side
// accents only (Sec 12): never the theme's verdict `error`/`success`
// colors, so a side can never be mistaken for an outcome.
const night = "#0B0F14";
const ironBorder = "#2A323D";
const frost = "#D8DEE6";
const steel = "#7C8695";
const bodyMuted = "#C1CAD4";
const bronze = "#A98548";
const proAccent = "#4C7A9E";
const conAccent = "#A9714F";

type PersonSeat = {
  id: ParticipantId;
  seatLabel: string;
  sideMeaning?: string;
  accent: string;
  portraitUrl: string;
};

const PRO_SEATS: PersonSeat[] = [
  { id: "advocate-pro-1", seatLabel: "PRO I", sideMeaning: "Defense", accent: proAccent, portraitUrl: portraitNorthernWarriorUrl },
  { id: "advocate-pro-2", seatLabel: "PRO II", sideMeaning: "Defense", accent: proAccent, portraitUrl: portraitRoyalAdviserUrl }
];

const CON_SEATS: PersonSeat[] = [
  {
    id: "advocate-con-1",
    seatLabel: "CON I",
    sideMeaning: "Opposition/Prosecution",
    accent: conAccent,
    portraitUrl: portraitSilverQueenUrl
  },
  {
    id: "advocate-con-2",
    seatLabel: "CON II",
    sideMeaning: "Opposition/Prosecution",
    accent: conAccent,
    portraitUrl: portraitMilitaryCommanderUrl
  }
];

// No verdict, no prediction (Sec 15): these cards carry no `sideMeaning`
// (that field is procedural-side context specific to Advocates) and no
// verdict/tint of any kind -- the persona-dossier format itself already
// makes clear these are pre-run profiles, so no extra "not yet ruled"
// caption is needed.
const JUDGE_SEATS: PersonSeat[] = [
  { id: "judge-1", seatLabel: "Judge I", accent: bronze, portraitUrl: portraitJudgeAharonBarakUrl },
  { id: "judge-2", seatLabel: "Judge II", accent: bronze, portraitUrl: portraitJudgeMenachemElonUrl },
  { id: "judge-3", seatLabel: "Judge III", accent: bronze, portraitUrl: portraitJudgeMeirShamgarUrl }
];

const DEMO_MAX_ESTIMATE = new Decimal(JON_SNOW_DEMO_MAX_ESTIMATE_USD);

function isWithinDemoPolicy(model: EligibleModel): boolean {
  return new Decimal(model.conservativeFullTribunalEstimateUsd).lte(DEMO_MAX_ESTIMATE);
}

// Deterministic, computed once at module load -- never `Math.random()`
// at render (Sec 16), so the flake set is fixed and rendering stays
// stable across re-renders and in tests. Purely decorative.
//
// M14 micro-polish (density pass): count raised from 34 to 58 and the
// opacity/size ranges widened slightly for a noticeably heavier "light
// snowstorm" feel while staying restrained -- still well short of
// anything resembling a blizzard or foreground clutter. `left`'s stride
// (37, coprime with 100) keeps the higher count well-distributed rather
// than clustering.
const SNOWFLAKES = Array.from({ length: 58 }, (_, index) => {
  const left = (index * 37) % 100;
  const size = 2 + (index % 5);
  const duration = 13 + (index % 7) * 2.5;
  const delay = -((index * 2.1) % duration);
  const opacity = 0.14 + (index % 4) * 0.05;

  return { delay, duration, left, opacity, size };
});

// Sec 16-18: a subtle, fixed (viewport-pinned, not page-height-pinned)
// CSS-only snow layer -- no canvas, no particle library, no new
// dependency. `pointerEvents: "none"` and `aria-hidden` keep it fully
// decorative; sitting behind the real content (which is explicitly
// `position: relative` with a higher stacking order below) means it is
// only ever visible in the page's own empty background space, never
// over a card. Animation duration is globally clamped under
// `prefers-reduced-motion: reduce` by jonSnowTheme.ts's existing
// MuiCssBaseline override, so reduced motion needs no extra handling
// here.
function SnowLayer() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        "@keyframes jonSnowFall": {
          "0%": { opacity: 0, transform: "translateY(-4vh) translateX(0)" },
          "12%": { opacity: 1 },
          "88%": { opacity: 1 },
          "100%": { opacity: 0, transform: "translateY(104vh) translateX(16px)" }
        },
        bottom: 0,
        left: 0,
        overflow: "hidden",
        pointerEvents: "none",
        position: "fixed",
        right: 0,
        top: 0,
        zIndex: 0
      }}
    >
      {SNOWFLAKES.map((flake, index) => (
        <Box
          key={index}
          sx={{
            animation: `jonSnowFall ${flake.duration}s linear ${flake.delay}s infinite`,
            bgcolor: frost,
            borderRadius: "50%",
            height: flake.size,
            left: `${flake.left}%`,
            opacity: flake.opacity,
            position: "absolute",
            top: 0,
            width: flake.size
          }}
        />
      ))}
    </Box>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{ color: bronze, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}
      variant="caption"
    >
      {children}
    </Typography>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.15}>
      <Typography
        sx={{ color: steel, fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}
      >
        {label}
      </Typography>
      <Typography sx={{ color: frost, fontSize: "0.86rem", fontWeight: 700 }}>{value}</Typography>
    </Stack>
  );
}

// Sec 10/13: the SAME horizontal persona-dossier card for both Advocates
// and Judges -- portrait on the left (a modest, consistent footprint,
// not a full poster), identity + the participant's own EXACT canonical
// `.personality` string on the right, rendered in full (Sec 5/14: no
// summarizing, shortening, paraphrasing, line-clamping, or "Read more").
function PersonDossierCard({
  accent,
  name,
  personality,
  portraitUrl,
  seatLabel,
  sideMeaning
}: {
  accent: string;
  name: string;
  personality: string;
  portraitUrl: string;
  seatLabel: string;
  sideMeaning?: string;
}) {
  return (
    <Box
      sx={{
        bgcolor: "#161B22",
        border: "1px solid",
        borderColor: ironBorder,
        borderRadius: 3,
        borderTop: `3px solid ${accent}`,
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        overflow: "hidden",
        position: "relative"
      }}
    >
      <Box
        sx={{
          // A fixed pixel height at `xs` (rather than relying on
          // `aspect-ratio` there) sidesteps a real cross-browser sizing
          // quirk found in manual review: inside a `flexDirection:
          // "column"` flex item, `aspect-ratio` alone did not reliably
          // constrain height, letting the portrait's own tall intrinsic
          // ratio win out and dominate the stacked mobile card. `sm`+
          // (a row layout) is unaffected -- aspect-ratio there matches
          // the source portraits' real 3:4 ratio exactly.
          aspectRatio: { sm: "3 / 4" },
          flexShrink: 0,
          height: { xs: 220, sm: "auto" },
          width: { xs: "100%", sm: 200, md: 232 }
        }}
      >
        <Box
          alt={name}
          component="img"
          loading="lazy"
          src={portraitUrl}
          sx={{ display: "block", height: "100%", objectFit: "cover", objectPosition: "center 18%", width: "100%" }}
        />
      </Box>
      <Box
        aria-hidden="true"
        sx={{
          color: accent,
          display: { xs: "none", md: "block" },
          opacity: 0.07,
          pointerEvents: "none",
          position: "absolute",
          right: -14,
          top: -14
        }}
      >
        <ScaleIcon size={90} />
      </Box>
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0, p: { xs: 2.5, sm: 3 }, position: "relative" }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography
            sx={{ color: accent, fontFamily: monoFontStack, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}
            variant="caption"
          >
            {seatLabel}
          </Typography>
          {sideMeaning ? (
            <Typography sx={{ color: steel }} variant="caption">
              {sideMeaning}
            </Typography>
          ) : null}
        </Stack>
        <Typography component="h3" sx={{ color: frost, fontFamily: displayFont, fontWeight: 600 }} variant="h5">
          {name}
        </Typography>
        <Divider sx={{ borderColor: ironBorder }} />
        <Typography
          sx={{ color: steel, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
          variant="caption"
        >
          Personality
        </Typography>
        {/* Sec 5/14/31: rendered directly from the canonical preset,
            verbatim -- no slicing, no clamping, no paraphrase. */}
        <Typography sx={{ color: bodyMuted, whiteSpace: "pre-wrap" }} variant="body2">
          {personality}
        </Typography>
      </Stack>
    </Box>
  );
}

export function JonSnowSettingsPage() {
  const navigate = useNavigate();
  // M14 access-gate fix (live-verified root cause: the Run button could
  // become enabled and submit even with no stored demo access capability,
  // producing a 401 demo_access_denied that useIdempotentStart's generic
  // fallback then misreported as a freeze failure). Read once at mount --
  // same pattern as JonSnowHomeCard.tsx's own `hasAccess` state -- this
  // is a client-side UX gate only; the server's own
  // isValidJonSnowDemoAccess check remains the sole authority and is
  // unchanged.
  const [hasDemoAccess] = useState(() => hasJonSnowDemoAccess());
  const [selectedModelId, setSelectedModelId] = useState<string>(JON_SNOW_DEFAULT_MODEL_ID);
  // Metadata-only catalog fetch (GET /api/models, zero cost) -- the same
  // existing hook used elsewhere. No onAutoSelect callback: this page
  // must never silently substitute a model for an ineligible/over-policy
  // default -- any change to `selectedModelId` here is an explicit user
  // action against the pre-filtered, in-policy list below.
  const { models, loading: modelsLoading, error: modelsError } = useEligibleModels();
  const { isSubmitting, error: runStartError, start } = useJonSnowDemoStart();

  const catalogReady = !modelsLoading && !modelsError;
  // Sec 17: currently eligible AND within the demo's own cost ceiling --
  // an over-policy model is omitted from this list entirely, never shown
  // disabled.
  const allowedModels = models.filter(isWithinDemoPolicy);
  const selectedModel = allowedModels.find((model) => model.id === selectedModelId);
  const canRun = hasDemoAccess && catalogReady && selectedModel !== undefined && !isSubmitting;

  async function handleRun() {
    if (!canRun) {
      return;
    }

    const result = await start(selectedModelId);

    if (!result) {
      return;
    }

    const { run, executionTriggered } = result;

    // M14 presentation-routing correction (PR #40): a Jon Snow run is a
    // real Tribunal run and must use the exact same generic Ivory &
    // Iron run/result experience every other run uses -- the dark
    // cinematic identity belongs to this settings page only, never to
    // the run/result screen itself. Navigates to the SAME generic route
    // History/Case Detail already use for every run regardless of
    // origin (src/app/App.tsx), not the removed Jon Snow-themed run
    // route.
    if (executionTriggered || run.status === "BLOCKED_BUDGET") {
      navigate(`/runs/${run.id}`);
    }
  }

  return (
    <Box sx={{ position: "relative" }}>
      <SnowLayer />
      {/* Sec 9: a self-contained, route-local "full-bleed" wrapper --
          breaks out of AppShell's centered `lg` Container (~1136px
          content width) without touching AppShell.tsx itself. `left:
          50%` + `margin-left: -50vw` is only correct because MUI's
          Container is itself horizontally centered on the page
          (margin-left/right: auto) regardless of its own maxWidth --
          the trick re-centers on the true viewport rather than the
          Container's narrower box. Kept off at `xs`/`sm` (the Container
          is already narrow enough there that breaking out adds no
          value and only risks mobile edge cases); the inner box then
          caps at ~94% of the viewport up to 1640px. */}
      <Box
        sx={{
          left: { md: "50%" },
          marginLeft: { md: "-50vw" },
          marginRight: { md: "-50vw" },
          position: { md: "relative" },
          right: { md: "50%" },
          width: { md: "100vw" }
        }}
      >
        <Box sx={{ maxWidth: 1640, mx: "auto", px: { xs: 0, md: 4, lg: 6 }, position: "relative", width: { md: "94%" }, zIndex: 1 }}>
          <Stack spacing={{ xs: 5, md: 7 }}>
            {/* 1. Cinematic hero, now recomposed to also hold the
                above-the-fold Run Configuration (Sec 6/7/20). */}
            <Box
              sx={{
                backgroundImage:
                  "linear-gradient(100deg, rgba(11,15,20,0.97) 0%, rgba(11,15,20,0.9) 40%, rgba(11,15,20,0.62) 72%, rgba(11,15,20,0.4) 100%), " +
                  `url(${heroFortressUrl})`,
                backgroundPosition: "center 38%",
                backgroundRepeat: "no-repeat",
                backgroundSize: "cover",
                border: "1px solid",
                borderColor: ironBorder,
                borderRadius: 4,
                overflow: "hidden",
                position: "relative"
              }}
            >
              {/* The banner now sits BEHIND both hero columns as a
                  soft, centered atmospheric motif (Sec 6/20) rather
                  than anchored over where the Run panel now lives --
                  low opacity, masked on every edge, never obstructing
                  either column's text/controls. */}
              <Box
                aria-hidden="true"
                sx={{
                  backgroundImage: `url(${northernWolfBannerUrl})`,
                  backgroundPosition: "top center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "contain",
                  bottom: 0,
                  display: { xs: "none", md: "block" },
                  left: "38%",
                  maskImage:
                    "radial-gradient(60% 62% at 50% 34%, #000 30%, rgba(0,0,0,0.4) 58%, transparent 88%)",
                  opacity: 0.22,
                  position: "absolute",
                  top: 0,
                  WebkitMaskImage:
                    "radial-gradient(60% 62% at 50% 34%, #000 30%, rgba(0,0,0,0.4) 58%, transparent 88%)",
                  width: 320,
                  zIndex: 0
                }}
              />
              <Box
                sx={{
                  display: "grid",
                  gap: { xs: 3, md: 5 },
                  gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1.3fr) minmax(300px, 1fr)" },
                  p: { xs: 3, md: 6 },
                  position: "relative",
                  zIndex: 1
                }}
              >
                <Stack spacing={2} sx={{ alignSelf: "center" }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box aria-hidden="true" sx={{ color: bronze, display: "flex" }}>
                      <ScaleIcon size={16} />
                    </Box>
                    <SectionEyebrow>Featured Tribunal Demo</SectionEyebrow>
                  </Stack>
                  <Typography
                    component="h1"
                    sx={{
                      color: frost,
                      fontFamily: displayFont,
                      fontSize: { xs: "2.1rem", md: "3rem" },
                      fontWeight: 600,
                      lineHeight: 1.05
                    }}
                    variant="h2"
                  >
                    The Realm v. Jon Snow
                  </Typography>
                  <Typography sx={{ color: bodyMuted, maxWidth: "50ch" }} variant="body1">
                    Case T-001: a canonical, deterministic case run through the real Tribunal
                    engine, operator-funded.
                  </Typography>
                </Stack>

                {/* Sec 6/7: the ONE real Run Configuration -- ONE
                    selector, ONE Run button, no duplicate later on the
                    page. Compact but complete: every truthful figure
                    from the previous bottom-of-page panel is still
                    here. */}
                <Box
                  sx={{
                    alignSelf: "center",
                    bgcolor: "rgba(11,15,20,0.7)",
                    border: "1px solid",
                    borderColor: "rgba(169,133,72,0.4)",
                    borderRadius: 3,
                    boxShadow: "0 18px 44px -22px rgba(0,0,0,0.7)",
                    p: { xs: 2.5, md: 3 }
                  }}
                >
                  <Stack spacing={1.75}>
                    <SectionEyebrow>Run This Tribunal</SectionEyebrow>

                    {modelsLoading ? (
                      <Typography sx={{ color: steel }} variant="body2">
                        Checking the current eligible model catalog...
                      </Typography>
                    ) : modelsError ? (
                      <Alert severity="error">{modelsError}</Alert>
                    ) : allowedModels.length === 0 ? (
                      <Alert severity="error">
                        No currently eligible model is within the operator-funded demo&rsquo;s $
                        {JON_SNOW_DEMO_MAX_ESTIMATE_USD} maximum.
                      </Alert>
                    ) : (
                      <TextField
                        fullWidth
                        label="Model"
                        onChange={(event) => setSelectedModelId(event.target.value)}
                        select
                        size="small"
                        value={selectedModel ? selectedModelId : ""}
                      >
                        {allowedModels.map((model) => (
                          <MenuItem key={model.id} value={model.id}>
                            {model.name} ({model.priceTier})
                          </MenuItem>
                        ))}
                      </TextField>
                    )}

                    {selectedModel ? (
                      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(2, 1fr)" }}>
                        <CompactStat label="Conservative estimate" value={`$${selectedModel.conservativeFullTribunalEstimateUsd}`} />
                        <CompactStat label="Logical calls" value="7" />
                        <CompactStat label="Demo funding" value="Operator-funded" />
                        <CompactStat label="Demo maximum" value={`$${JON_SNOW_DEMO_MAX_ESTIMATE_USD}`} />
                        <CompactStat label="Retry policy" value="Max 1 retry / participant" />
                        <CompactStat label="Hard ceiling" value="$5.00" />
                      </Box>
                    ) : null}

                    <Typography sx={{ color: steel, fontSize: "0.72rem" }}>
                      Discovery estimate only -- the authoritative server preflight runs again,
                      using the operator&rsquo;s own credential, when you Run.
                    </Typography>

                    {/* M14 access-gate fix: the case/advocates/judges/
                        personalities/model catalog/economics above
                        remain fully visible and reviewable without
                        access (Sec 1) -- only the Run action itself is
                        gated. Never an OpenRouter key field, never an
                        access-token input, never a redirect. */}
                    {!hasDemoAccess ? (
                      <Alert severity="info">
                        Lecturer demo access is required to run this operator-funded case. Open
                        the prepared demo link to enable execution.
                      </Alert>
                    ) : null}

                    {runStartError ? <Alert severity="error">{runStartError}</Alert> : null}

                    {/* Sec 8: a premium but restrained primary CTA --
                        real disabled/submitting states and copy are
                        unchanged; only the surface, border, shadow, and
                        hover/focus treatment are new. */}
                    <Button
                      disabled={!canRun}
                      fullWidth
                      onClick={handleRun}
                      size="large"
                      startIcon={<ScaleIcon size={18} />}
                      sx={{
                        background: "linear-gradient(160deg, #4C7A9E 0%, #335A75 100%)",
                        border: "1px solid rgba(216,222,230,0.24)",
                        borderRadius: "10px",
                        boxShadow: "0 12px 28px -10px rgba(61,107,140,0.55), inset 0 1px 0 rgba(255,255,255,0.16)",
                        color: "#FFFFFF",
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                        transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
                        "&:hover": {
                          background: "linear-gradient(160deg, #5A8AB0 0%, #3D6B8C 100%)",
                          borderColor: "rgba(216,222,230,0.4)",
                          boxShadow: "0 16px 34px -10px rgba(61,107,140,0.7), inset 0 1px 0 rgba(255,255,255,0.22)",
                          transform: "translateY(-1px)"
                        },
                        "&:focus-visible": {
                          outline: "3px solid rgba(76,122,158,0.55)",
                          outlineOffset: 2
                        },
                        "&.Mui-disabled": {
                          background: "rgba(216,222,230,0.1)",
                          border: "1px solid rgba(216,222,230,0.14)",
                          boxShadow: "none",
                          color: "#7C8695"
                        }
                      }}
                      variant="contained"
                    >
                      {isSubmitting ? "Starting..." : "Run Jon Snow Demo"}
                    </Button>
                  </Stack>
                </Box>
              </Box>
            </Box>

            {/* 2. Case Dossier -- preserved as-is, only now sitting
                inside the wider route-local column (Sec 19). */}
            <Box
              sx={{
                backgroundColor: night,
                backgroundImage: `linear-gradient(rgba(11,15,20,0.93), rgba(11,15,20,0.93)), url(${darkPanelTextureUrl})`,
                backgroundSize: "cover",
                border: "1px solid",
                borderColor: ironBorder,
                borderRadius: 4,
                overflow: "hidden",
                p: { xs: 3, md: 5 },
                position: "relative"
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  backgroundImage: `url(${northernWolfCrestUrl})`,
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "contain",
                  bottom: -36,
                  height: 220,
                  opacity: 0.06,
                  pointerEvents: "none",
                  position: "absolute",
                  right: -36,
                  width: 220
                }}
              />
              {/* M14 micro-fix: no reading-column cap and no centering
                  -- the dossier content now spans the card's full inner
                  width (100%, left-aligned, normal padding), growing
                  and shrinking with the card responsively. No text
                  content changed. */}
              <Stack spacing={2.5} sx={{ position: "relative", width: "100%" }}>
                <SectionEyebrow>The Case Before The Tribunal</SectionEyebrow>
                <Typography component="h2" sx={{ color: frost, fontFamily: displayFont, fontWeight: 600 }} variant="h3">
                  Case Dossier
                </Typography>
                <Divider sx={{ borderColor: ironBorder }} />
                <Stack spacing={0.75}>
                  <Typography
                    sx={{ color: bronze, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}
                    variant="caption"
                  >
                    Defendant
                  </Typography>
                  <Typography sx={{ color: frost, fontFamily: displayFont, fontWeight: 600 }} variant="h5">
                    {JON_SNOW_CHARGE_SHEET.defendant}
                  </Typography>
                </Stack>
                <Divider sx={{ borderColor: ironBorder }} />
                <Stack spacing={0.75}>
                  <Typography
                    sx={{ color: bronze, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}
                    variant="caption"
                  >
                    Disputed Act
                  </Typography>
                  <Typography sx={{ color: bodyMuted, whiteSpace: "pre-wrap" }} variant="body1">
                    {JON_SNOW_CHARGE_SHEET.act}
                  </Typography>
                </Stack>
                <Divider sx={{ borderColor: ironBorder }} />
                <Stack spacing={0.75}>
                  <Typography
                    sx={{ color: bronze, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}
                    variant="caption"
                  >
                    Question Before The Tribunal
                  </Typography>
                  <Typography sx={{ color: frost, fontStyle: "italic" }} variant="body1">
                    {JON_SNOW_CHARGE_SHEET.exactQuestion}
                  </Typography>
                </Stack>
                <Divider sx={{ borderColor: ironBorder }} />
                <Typography sx={{ color: steel }} variant="caption">
                  Canonical preset {JON_SNOW_PRESET_VERSION}, drawn verbatim from the lecturer&rsquo;s
                  case-design dossier. Shared model -- one model, seven fixed roles and
                  personalities. The assigned seat fixes only each participant&rsquo;s procedural
                  role and directional stance (PRO argues toward NOT_GUILTY, CON argues toward
                  GUILTY); it does not fix any specific reasoning, evidence weighting, or argument,
                  and no Judge&rsquo;s verdict is predetermined.
                </Typography>
              </Stack>
            </Box>

            {/* 3. Advocates -- now horizontal persona dossiers (Sec
                10-12): portrait on the left, identity + the exact
                canonical personality on the right. One card per row
                (Sec 12: "READABILITY WINS") -- the personality
                paragraphs are long enough that two side-by-side would
                cramp the text column on anything short of an
                ultra-wide screen. */}
            <Stack spacing={{ xs: 3, md: 4 }}>
              <Stack spacing={1}>
                <SectionEyebrow>Counsel Before The Tribunal</SectionEyebrow>
                <Typography component="h2" sx={{ color: frost, fontFamily: displayFont, fontWeight: 600 }} variant="h3">
                  The Advocates
                </Typography>
              </Stack>
              <Stack spacing={{ xs: 3, md: 3.5 }}>
                <Stack spacing={1.5}>
                  <Typography
                    sx={{ color: proAccent, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}
                    variant="caption"
                  >
                    For The Defense &middot; PRO
                  </Typography>
                  <Stack spacing={2}>
                    {PRO_SEATS.map((seat) => (
                      <PersonDossierCard
                        accent={seat.accent}
                        key={seat.id}
                        // Schema-level `profileName` is optional (any
                        // ParticipantDraft may omit it); the canonical
                        // preset itself always populates it for all
                        // seven fixed seats (validated at module load
                        // by canonicalPreset.ts's own
                        // participantDraftSchema.parse), so this
                        // fallback is structurally unreachable here --
                        // it exists only to satisfy the wider schema
                        // type honestly, same fallback-to-seat-label
                        // convention as participantIdentity.ts.
                        name={JON_SNOW_PARTICIPANTS[seat.id].profileName ?? seat.seatLabel}
                        personality={JON_SNOW_PARTICIPANTS[seat.id].personality}
                        portraitUrl={seat.portraitUrl}
                        seatLabel={seat.seatLabel}
                        sideMeaning={seat.sideMeaning}
                      />
                    ))}
                  </Stack>
                </Stack>
                <Stack spacing={1.5}>
                  <Typography
                    sx={{ color: conAccent, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}
                    variant="caption"
                  >
                    For The Opposition &middot; CON
                  </Typography>
                  <Stack spacing={2}>
                    {CON_SEATS.map((seat) => (
                      <PersonDossierCard
                        accent={seat.accent}
                        key={seat.id}
                        name={JON_SNOW_PARTICIPANTS[seat.id].profileName ?? seat.seatLabel}
                        personality={JON_SNOW_PARTICIPANTS[seat.id].personality}
                        portraitUrl={seat.portraitUrl}
                        seatLabel={seat.seatLabel}
                        sideMeaning={seat.sideMeaning}
                      />
                    ))}
                  </Stack>
                </Stack>
              </Stack>
            </Stack>

            {/* 4. Judicial Panel -- same persona-dossier treatment and
                the same visual weight as Advocates (Sec 13-15): no
                sideMeaning, no verdict, no prediction. */}
            <Stack spacing={{ xs: 2.5, md: 3 }}>
              <Stack spacing={1}>
                <SectionEyebrow>The Judicial Panel</SectionEyebrow>
                <Typography component="h2" sx={{ color: frost, fontFamily: displayFont, fontWeight: 600 }} variant="h3">
                  The Judges
                </Typography>
              </Stack>
              <Stack spacing={2}>
                {JUDGE_SEATS.map((seat) => (
                  <PersonDossierCard
                    accent={seat.accent}
                    key={seat.id}
                    name={JON_SNOW_PARTICIPANTS[seat.id].profileName ?? seat.seatLabel}
                    personality={JON_SNOW_PARTICIPANTS[seat.id].personality}
                    portraitUrl={seat.portraitUrl}
                    seatLabel={seat.seatLabel}
                  />
                ))}
              </Stack>
            </Stack>

            {/* 5. Existing disclaimer / closing treatment */}
            <Stack spacing={2}>
              <Alert severity="info">{JON_SNOW_DOSSIER_DISCLAIMER}</Alert>
              <Typography sx={{ color: steel, fontStyle: "italic", textAlign: "center" }} variant="body2">
                The realm asks one question. The Tribunal answers with reasons.
              </Typography>
            </Stack>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
