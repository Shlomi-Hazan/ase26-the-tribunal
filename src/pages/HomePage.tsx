// Milestone 12 -- Home surface (Issue #32 Sec 5). `/` previously
// redirected straight into `/new/charge-sheet` -- there was no Home page.
// This is the smallest generic surface exposing exactly three actions:
// Create/New Tribunal, Past Cases, and the Featured Jon Snow Demo. Only
// the Jon Snow card below carries GoT-themed presentation (Issue #32
// Sec 10); everything else on this page, and the rest of the site,
// stays Tribunal-generic.
//
// Milestone 14 (Ivory & Iron, Issue #39 Phase 2) -- adds a hero section
// above the existing 3-card grid. Purely presentational: no new action,
// no new route. The hero's two buttons link to the SAME two routes the
// cards below already expose (/new/charge-sheet, /demo/jon-snow) -- the
// cards are not removed, they remain the secondary, detailed reinforcement
// of the same three actions the hero elevates.
//
// Milestone 14 visual-correction pass (PR #40) -- brings Home much
// closer to the approved reference direction: a richer, deeper hero
// composition, icon-led action cards, and two new, purely informational
// sections (fixed-fact stats, and a "how it works" outline of the real
// existing flow). Nothing here is a new feature or a new route -- every
// number and step below is already true of the product as built.
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { HomeHeroArt } from "../components/HomeHeroArt";
import {
  BarChartIcon,
  ChatIcon,
  ChevronRightIcon,
  ClockHistoryIcon,
  DocumentIcon,
  GavelIcon,
  GearIcon,
  PortraitIcon,
  ScaleIcon,
  UsersIcon
} from "../components/icons/LineIcons";
import { JonSnowHomeCard } from "../components/JonSnowHomeCard";

const actionCards = [
  {
    icon: DocumentIcon,
    title: "Start a New Case",
    description:
      "Enter your own Charge Sheet, configure seven participants, and convene a real deliberation.",
    to: "/new/charge-sheet",
    cta: "New Tribunal"
  },
  {
    icon: ClockHistoryIcon,
    title: "Past Cases",
    description:
      "Reopen a stored case and inspect any Tribunal runs associated with it -- read-only, no model calls.",
    to: "/history",
    cta: "View Past Cases"
  }
] as const;

const stats = [
  { icon: UsersIcon, value: "4", label: "Advocates", description: "Four fixed seats argue both directions of the case." },
  { icon: UsersIcon, value: "3", label: "Judges", description: "Three fixed seats each cast one independent vote." },
  { icon: ScaleIcon, value: null, label: "Deterministic Majority", description: "The verdict is a fixed, auditable rule -- never a guess." },
  { icon: BarChartIcon, value: null, label: "Economic Transparency", description: "Every run's tokens and cost are recorded and viewable." }
] as const;

const howItWorks = [
  {
    icon: GearIcon,
    title: "Setup",
    description: "Define the Charge Sheet and configure the seven fixed participant seats."
  },
  {
    icon: ChatIcon,
    title: "Deliberation",
    description: "Advocates argue in a fixed order; judges deliberate independently after."
  },
  {
    icon: GavelIcon,
    title: "Verdict",
    description: "A deterministic majority rule decides -- with full economics and audit trail."
  }
] as const;

export function HomePage() {
  return (
    <Stack spacing={{ xs: 6, md: 8 }}>
      <Box
        component="section"
        sx={{
          background: "linear-gradient(160deg, #FBF3E2 0%, #F1E6C9 55%, #EADFC0 100%)",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 5,
          boxShadow: "0 1px 2px rgba(36,33,28,.05), 0 24px 48px -20px rgba(154,110,40,.35)",
          overflow: "hidden",
          p: { xs: 3, sm: 5, md: 6 },
          position: "relative"
        }}
      >
        <Box
          sx={{
            alignItems: "center",
            display: "grid",
            gap: { xs: 4, md: 6 },
            gridTemplateColumns: { xs: "1fr", md: "1.05fr 0.95fr" },
            position: "relative"
          }}
        >
          <Stack spacing={2.5}>
            <Typography
              color="secondary.main"
              sx={{ fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}
              variant="caption"
            >
              The Tribunal
            </Typography>
            <Typography
              component="h1"
              sx={{
                fontSize: { xs: "2.25rem", sm: "3rem", md: "3.75rem" },
                textWrap: "balance"
              }}
              variant="h2"
            >
              Deliberation,
              <br />
              <Box component="span" sx={{ color: "#8C6423" }}>
                Reimagined.
              </Box>
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: "50ch" }} variant="body1">
              An educational AI deliberation exercise with seven fixed participants: four
              advocates, three judges, one deterministic majority verdict -- every run fully
              auditable.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ pt: 1 }}>
              <Button
                component={RouterLink}
                size="large"
                startIcon={<ScaleIcon size={18} />}
                to="/new/charge-sheet"
                variant="contained"
              >
                Start New Case
              </Button>
              <Button
                component={RouterLink}
                size="large"
                startIcon={<PortraitIcon size={18} />}
                to="/demo/jon-snow"
                variant="outlined"
              >
                Open Jon Snow Demo
              </Button>
            </Stack>
          </Stack>
          <Box
            sx={{
              aspectRatio: "4 / 3",
              borderRadius: 4,
              boxShadow: "0 20px 48px -16px rgba(154,110,40,.45)",
              display: { xs: "none", sm: "block" },
              overflow: "hidden"
            }}
          >
            <HomeHeroArt />
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }
        }}
      >
        {actionCards.map((card) => (
          <Card
            component="section"
            key={card.to}
            sx={{
              transition: "transform 150ms ease, box-shadow 150ms ease",
              "&:hover": {
                boxShadow: "0 1px 2px rgba(36,33,28,.05), 0 16px 32px -12px rgba(36,33,28,.18)",
                transform: "translateY(-2px)"
              }
            }}
          >
            <CardContent>
              <Stack spacing={1.5}>
                <Box
                  sx={{
                    alignItems: "center",
                    bgcolor: "rgba(184,137,43,0.12)",
                    borderRadius: "50%",
                    color: "#8C6423",
                    display: "flex",
                    height: 44,
                    justifyContent: "center",
                    width: 44
                  }}
                >
                  <card.icon size={22} />
                </Box>
                <Typography component="h2" variant="h6">
                  {card.title}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {card.description}
                </Typography>
                <Button
                  component={RouterLink}
                  endIcon={<ChevronRightIcon size={16} />}
                  sx={{ alignSelf: "flex-start" }}
                  to={card.to}
                  variant={card.to === "/new/charge-sheet" ? "contained" : "outlined"}
                >
                  {card.cta}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
        <JonSnowHomeCard />
      </Box>

      <Box
        component="section"
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 4,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }
        }}
      >
        {stats.map((stat, index) => (
          <Box
            key={stat.label}
            sx={{
              borderColor: "divider",
              borderLeft: { md: index === 0 ? "none" : "1px solid" },
              borderTop: {
                xs: index === 0 ? "none" : "1px solid",
                sm: index < 2 ? "none" : "1px solid",
                md: "none"
              },
              p: 3
            }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
              <Box sx={{ color: "#8C6423", pt: 0.25 }}>
                <stat.icon size={24} />
              </Box>
              <Stack spacing={0.25}>
                {stat.value ? (
                  <Typography sx={{ fontFamily: '"Fraunces", Georgia, serif' }} variant="h4">
                    {stat.value}
                  </Typography>
                ) : null}
                <Typography sx={{ fontWeight: 700 }} variant="subtitle1">
                  {stat.label}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {stat.description}
                </Typography>
              </Stack>
            </Stack>
          </Box>
        ))}
      </Box>

      <Stack component="section" spacing={4}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "center" }}>
          <Box sx={{ bgcolor: "divider", flex: 1, height: "1px", maxWidth: 120 }} />
          <Typography
            component="h2"
            sx={{ fontFamily: '"Fraunces", Georgia, serif', whiteSpace: "nowrap" }}
            variant="h5"
          >
            How it works
          </Typography>
          <Box sx={{ bgcolor: "divider", flex: 1, height: "1px", maxWidth: 120 }} />
        </Stack>
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }
          }}
        >
          {howItWorks.map((step, index) => (
            <Box
              key={step.title}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 3,
                p: 3,
                position: "relative"
              }}
            >
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <Box
                    sx={{
                      alignItems: "center",
                      border: "1px solid",
                      borderColor: "#8C6423",
                      borderRadius: "50%",
                      color: "#8C6423",
                      display: "flex",
                      flexShrink: 0,
                      fontFamily: '"Fraunces", Georgia, serif',
                      fontWeight: 700,
                      height: 32,
                      justifyContent: "center",
                      width: 32
                    }}
                  >
                    {index + 1}
                  </Box>
                  <Box sx={{ color: "#8C6423" }}>
                    <step.icon size={22} />
                  </Box>
                </Stack>
                <Typography component="h3" variant="subtitle1">
                  {step.title}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {step.description}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Box>
      </Stack>
    </Stack>
  );
}
