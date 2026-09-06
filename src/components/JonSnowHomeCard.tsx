// Home's Jon Snow card remains real accessible UI, not a baked-in image:
// the whole card links to the existing /demo/jon-snow entry/settings route
// while retaining compact, truthful model/access context.
import { Box, Card, Stack, Typography } from "@mui/material";
import Decimal from "decimal.js";
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import demoBannerUrl from "../assets/jon-snow-demo-banner.png";
import demoCardBackgroundUrl from "../assets/jon-snow-demo-card-bg.png";
import { useEligibleModels } from "../features/case-setup/useEligibleModels";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { JON_SNOW_DEMO_MAX_ESTIMATE_USD } from "../features/jon-snow-demo/jonSnowDemoEconomics";
import { hasJonSnowDemoAccess } from "../services/jonSnowDemoAccess";
import { BarChartIcon, ChevronRightIcon, ScaleIcon } from "./icons/LineIcons";

const night = "#060A0F";
const frost = "#E3E8EE";
const steel = "#9AA4B2";
const direBronze = "#C79A56";

export function JonSnowHomeCard() {
  // Read once at mount -- src/main.tsx already captured any `#demo=...`
  // fragment into sessionStorage before this component (or any other
  // React component) ever rendered.
  const [hasAccess] = useState(() => hasJonSnowDemoAccess());
  // Metadata-only catalog fetch (GET /api/models, zero cost) -- no
  // pricing is computed in browser code; every figure below is read
  // directly from this response.
  const { models, loading: modelsLoading, error: modelsError } = useEligibleModels();

  const catalogReady = !modelsLoading && !modelsError;
  const defaultModel = models.find((model) => model.id === JON_SNOW_DEFAULT_MODEL_ID);
  const defaultInPolicy =
    defaultModel !== undefined &&
    new Decimal(defaultModel.conservativeFullTribunalEstimateUsd).lte(
      new Decimal(JON_SNOW_DEMO_MAX_ESTIMATE_USD)
    );
  const defaultOutOfPolicy = catalogReady && defaultModel !== undefined && !defaultInPolicy;
  const modelLabel = modelsLoading
    ? "Checking model"
    : modelsError
      ? "Model status unavailable"
      : defaultModel?.name ?? JON_SNOW_DEFAULT_MODEL_ID;
  const policyLabel = defaultOutOfPolicy ? "Review settings" : "Ceiling";
  const statusLabel =
    defaultOutOfPolicy
      ? "Default model is outside the demo ceiling; review settings before running."
      : hasAccess
        ? "Ready to review the canonical demo settings."
        : "Lecturer access is required to run; settings remain reviewable.";

  return (
    <Card
      aria-label="Open The Realm v. Jon Snow Demo"
      component={RouterLink}
      sx={{
        backgroundColor: night,
        backgroundImage: {
          xs:
            "linear-gradient(90deg, rgba(6,10,15,0.98) 0%, rgba(6,10,15,0.9) 62%, rgba(6,10,15,0.54) 100%), " +
            `url(${demoCardBackgroundUrl})`,
          md:
            "linear-gradient(90deg, rgba(6,10,15,0.98) 0%, rgba(6,10,15,0.92) 44%, rgba(6,10,15,0.5) 72%, rgba(6,10,15,0.24) 100%), " +
            `url(${demoCardBackgroundUrl})`
        },
        backgroundPosition: { xs: "57% center", md: "center center" },
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
        border: "1px solid rgba(179,145,91,0.34)",
        borderRadius: "14px",
        boxShadow:
          "0 22px 52px -28px rgba(5,8,12,0.95), inset 0 1px 0 rgba(255,255,255,0.1)",
        color: frost,
        display: "block",
        minHeight: { xs: 218, md: 154 },
        overflow: "hidden",
        position: "relative",
        textDecoration: "none",
        transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
        "&:before": {
          background:
            "radial-gradient(circle at 78% 24%, rgba(122,158,184,0.22), rgba(122,158,184,0) 30%), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 26%, rgba(0,0,0,0.12) 100%)",
          content: '""',
          inset: 0,
          pointerEvents: "none",
          position: "absolute",
          zIndex: 1
        },
        "&:hover": {
          borderColor: "rgba(212,171,103,0.72)",
          boxShadow:
            "0 26px 62px -30px rgba(5,8,12,1), inset 0 1px 0 rgba(255,255,255,0.14)",
          transform: "translateY(-2px)"
        },
        "&:focus-visible": {
          outline: "3px solid rgba(199,154,86,0.66)",
          outlineOffset: 3
        }
      }}
      to="/demo/jon-snow"
    >
      {/* Milestone 14 visual-correction pass (PR #40, background
          blending correction): the banner asset is its own rectangular
          photo (a dark starfield behind the cloth, not an alpha-cut
          sigil) -- rendered at a fixed size with backgroundSize:cover,
          its own edges previously showed as a visible hard-edged panel
          against the card's own castle background. A radial mask fades
          it to fully transparent well before the box edges, so only
          the wolf sigil itself stays opaque and everything around it
          dissolves into the card's own background/scrim beneath --
          one composited scene, not two stacked images. */}
      <Box
        aria-hidden="true"
        sx={{
          backgroundImage: `url(${demoBannerUrl})`,
          backgroundPosition: "center 22%",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          bottom: { xs: -60, md: -46 },
          maskImage:
            "radial-gradient(60% 62% at 55% 40%, #000 38%, rgba(0,0,0,0.55) 60%, transparent 90%)",
          maskRepeat: "no-repeat",
          WebkitMaskImage:
            "radial-gradient(60% 62% at 55% 40%, #000 38%, rgba(0,0,0,0.55) 60%, transparent 90%)",
          WebkitMaskRepeat: "no-repeat",
          opacity: { xs: 0.42, sm: 0.55, md: 0.85 },
          pointerEvents: "none",
          position: "absolute",
          right: { xs: -52, sm: -34, md: -18 },
          top: { xs: -44, md: -34 },
          width: { xs: 190, sm: 224, md: 208 },
          zIndex: 1
        }}
      />

      <Stack
        spacing={1}
        sx={{
          height: "100%",
          justifyContent: "space-between",
          p: { xs: 2.25, md: 2.05 },
          position: "relative",
          zIndex: 3
        }}
      >
        <Stack spacing={0.62} sx={{ maxWidth: { xs: "calc(100% - 86px)", md: "65%" } }}>
          <Stack direction="row" spacing={0.9} sx={{ alignItems: "center" }}>
            <Box sx={{ color: direBronze, display: "flex" }}>
              <ScaleIcon size={17} />
            </Box>
            <Typography
              sx={{
                color: direBronze,
                fontWeight: 800,
                letterSpacing: 0,
                textTransform: "uppercase"
              }}
              variant="caption"
            >
              Featured demo
            </Typography>
          </Stack>
          <Typography
            component="h2"
            sx={{
              color: frost,
              fontFamily: '"Fraunces", Georgia, serif',
              fontSize: { xs: "1.48rem", md: "1.28rem" },
              fontWeight: 650,
              letterSpacing: 0,
              lineHeight: 1.02,
              textShadow: "0 2px 12px rgba(0,0,0,0.55)"
            }}
          >
            The Realm v.{" "}
            <Box component="span" sx={{ color: "#D8B06D" }}>
              Jon Snow
            </Box>
          </Typography>
          <Typography
            sx={{
              color: "#C1CAD4",
              fontSize: { xs: "0.84rem", md: "0.75rem" },
              lineHeight: 1.22,
              textShadow: "0 2px 10px rgba(0,0,0,0.48)"
            }}
            variant="body2"
          >
            Canonical case with fixed advocates, three judges, and the real Tribunal engine.
          </Typography>
        </Stack>

        <Stack spacing={{ xs: 1, md: 0.85 }} sx={{ pt: { xs: 1.65, md: 1.2 } }}>
          <Stack
            direction="row"
            spacing={{ xs: 1.35, md: 1.15 }}
            sx={{ alignItems: "center", minWidth: 0 }}
          >
            <Box sx={{ color: steel, display: "flex", flexShrink: 0 }}>
              <BarChartIcon size={23} />
            </Box>
            <Stack spacing={0.14} sx={{ minWidth: 0 }}>
              <Typography sx={{ color: steel, fontSize: "0.68rem", lineHeight: 1.12 }} variant="caption">
                Default model
              </Typography>
              <Typography
                noWrap
                sx={{
                  color: frost,
                  fontSize: { xs: "0.88rem", md: "0.74rem" },
                  fontWeight: 760,
                  lineHeight: 1.12
                }}
                variant="body2"
              >
                {modelLabel}
              </Typography>
            </Stack>
            <Box
              sx={{
                bgcolor: "rgba(227,232,238,0.26)",
                display: { xs: "none", sm: "block" },
                height: 34,
                width: "1px"
              }}
            />
            <Stack spacing={0.14} sx={{ flexShrink: 0 }}>
              <Typography sx={{ color: steel, fontSize: "0.68rem", lineHeight: 1.12 }} variant="caption">
                {policyLabel}
              </Typography>
              <Typography
                sx={{
                  color: frost,
                  fontSize: { xs: "0.88rem", md: "0.78rem" },
                  fontWeight: 760,
                  lineHeight: 1.12
                }}
                variant="body2"
              >
                ${JON_SNOW_DEMO_MAX_ESTIMATE_USD}
              </Typography>
            </Stack>
          </Stack>

          <Typography
            sx={{
              color: defaultOutOfPolicy ? "#D8A65F" : "#8E99A7",
              fontSize: "0.66rem",
              lineHeight: 1.08,
              maxWidth: { md: "64%" }
            }}
            variant="body2"
          >
            {statusLabel}
          </Typography>

          {/* Milestone 14 visual-correction pass (Home feature-card
              refinement, PR #40): anchored to the lower-right, below
              the model/ceiling info and the access note -- previously
              sat in the same row as that info and collided visually
              with the wolf/banner artwork above it. */}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Box
              aria-hidden="true"
              sx={{
                alignItems: "center",
                border: "1px solid rgba(199,154,86,0.72)",
                borderRadius: "9px",
                color: "#E7D0A7",
                display: "flex",
                gap: 0.75,
                minHeight: 38,
                minWidth: { xs: 154, md: 142 },
                px: 1.45
              }}
            >
              <Typography
                sx={{
                  color: frost,
                  fontFamily: '"Fraunces", Georgia, serif',
                  fontSize: { xs: "1rem", md: "0.96rem" },
                  lineHeight: 1
                }}
              >
                Modify settings
              </Typography>
              <ChevronRightIcon size={18} />
            </Box>
          </Box>
        </Stack>
      </Stack>
    </Card>
  );
}
