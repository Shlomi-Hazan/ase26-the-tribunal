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
import { Box, Button, Card, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import courthouseHeroUrl from "../assets/home-courthouse-hero.png";
import newCaseBackgroundUrl from "../assets/home-new-case-bg.png";
import pastCasesBackgroundUrl from "../assets/home-past-cases-bg.png";
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

// Milestone 14 visual-correction pass (Home feature-card refinement,
// PR #40): both light cards now share Jon Snow's own card grammar --
// eyebrow, serif title, description, a bottom metadata row, and a
// circular arrow -- so all three read as one intentional system. Every
// metadata label below is a fixed, already-true product fact (never a
// live-fetched count): Home does not query case/run totals, so no
// number is fabricated here (per the explicit instruction, labels only
// where no real figure is available on this page).
const actionCards = [
  {
    to: "/new/charge-sheet",
    ariaLabel: "Start a New Case",
    eyebrow: "BEGIN A DELIBERATION",
    title: "Start a New Case",
    description:
      "Define your Charge Sheet, configure four advocates and three judges, then review the Tribunal before convening it.",
    accent: "#9A6B21",
    backgroundUrl: newCaseBackgroundUrl,
    metadata: [
      { icon: DocumentIcon, label: "Charge Sheet" },
      { icon: UsersIcon, label: "4 Advocates" },
      { icon: GavelIcon, label: "3 Judges" }
    ]
  },
  {
    to: "/history",
    ariaLabel: "Past Cases",
    eyebrow: "REVISIT & AUDIT",
    title: "Past Cases",
    description:
      "Reopen stored cases and inspect their Tribunal runs, reasoning, protocol, and economics that remain available.",
    accent: "#8C6423",
    backgroundUrl: pastCasesBackgroundUrl,
    metadata: [
      { icon: DocumentIcon, label: "Stored Cases" },
      { icon: ClockHistoryIcon, label: "Run History" },
      { icon: BarChartIcon, label: "Economics & Audit" }
    ]
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
    description:
      "Four advocates present arguments concurrently. Once all four complete, three judges evaluate independently."
  },
  {
    icon: GavelIcon,
    title: "Verdict",
    description: "A deterministic majority rule decides -- with full economics and audit trail."
  }
] as const;

export function HomePage() {
  return (
    <Box
      sx={{
        background: "linear-gradient(180deg, #FFF8EC 0%, #F8F0E0 56%, #F4EBD9 100%)",
        borderRadius: { md: "0 0 20px 20px" },
        mx: { xs: -2, sm: -3, md: -4 },
        mt: { xs: -3, md: -5 },
        overflow: "hidden",
        px: { xs: 1.5, sm: 2.5, md: 3.5 },
        pb: { xs: 4, md: 4.5 },
        pt: { xs: 2, md: 3.5 },
        position: "relative"
      }}
    >
      <Box
        component="section"
        sx={{
          backgroundImage: {
            xs:
              "linear-gradient(180deg, rgba(255,248,236,0.74) 0%, rgba(255,248,236,0.88) 48%, rgba(255,248,236,0.95) 100%), " +
              `url(${courthouseHeroUrl})`,
            md:
              "linear-gradient(90deg, rgba(255,248,236,0.98) 0%, rgba(255,248,236,0.92) 30%, rgba(255,248,236,0.36) 54%, rgba(255,248,236,0.04) 100%), " +
              `url(${courthouseHeroUrl})`
          },
          backgroundPosition: { xs: "56% 10%", sm: "58% 18%", md: "center center" },
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          border: "1px solid rgba(210,185,143,0.36)",
          borderRadius: { xs: "0 0 14px 14px", md: 0 },
          boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.52)",
          isolation: "isolate",
          minHeight: { xs: 540, sm: 580, md: 540, lg: 590 },
          mx: "auto",
          overflow: "hidden",
          px: { xs: 2.5, sm: 5, md: 8 },
          py: { xs: 6, sm: 7.2, md: 6.4 },
          position: "relative"
        }}
      >
        <Box
          sx={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0) 34%, rgba(98,65,18,0.07) 100%)",
            inset: 0,
            pointerEvents: "none",
            position: "absolute",
            zIndex: -1
          }}
        />
        <Box
          sx={{
            maxWidth: { xs: "100%", md: 660 },
            pt: { xs: 1, md: 1.5 }
          }}
        >
          <Stack spacing={{ xs: 2.2, md: 2.35 }}>
            <Typography
              sx={{
                color: "#1E1A16",
                fontSize: "0.82rem",
                fontWeight: 800,
                letterSpacing: 0,
                textTransform: "uppercase"
              }}
              variant="caption"
            >
              The Tribunal
            </Typography>
            <Typography
              component="h1"
              sx={{
                color: "#171514",
                fontFamily: '"Fraunces", Georgia, serif',
                fontSize: { xs: "3.28rem", sm: "5rem", md: "5.85rem", lg: "6.35rem" },
                fontWeight: 700,
                letterSpacing: 0,
                lineHeight: 0.88,
                textWrap: "balance"
              }}
              variant="h1"
            >
              Deliberation,
              <br />
              <Box component="span" sx={{ color: "#9A6B21" }}>
                Reimagined.
              </Box>
            </Typography>
            <Typography
              sx={{
                color: "#23201C",
                fontSize: { xs: "1.08rem", md: "1.18rem" },
                lineHeight: 1.36,
                maxWidth: "49ch"
              }}
              variant="body1"
            >
              An educational AI deliberation exercise with seven fixed participants: four
              advocates, three judges, one deterministic majority verdict -- every run fully
              auditable.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ pt: 1.35 }}>
              <Button
                component={RouterLink}
                endIcon={<ChevronRightIcon size={18} />}
                size="large"
                startIcon={<ScaleIcon size={18} />}
                sx={{
                  bgcolor: "#B27B1F",
                  border: "1px solid rgba(92,59,14,0.22)",
                  borderRadius: "10px",
                  boxShadow: "0 16px 30px -18px rgba(95,59,12,0.72)",
                  color: "#FFFFFF",
                  minHeight: 54,
                  minWidth: { sm: 250 },
                  px: 3,
                  "&:hover": {
                    bgcolor: "#855D1C",
                    boxShadow: "0 18px 34px -20px rgba(95,59,12,0.8)",
                    color: "#FFFFFF",
                    transform: "translateY(-1px)"
                  }
                }}
                to="/new/charge-sheet"
                variant="contained"
              >
                New Tribunal
              </Button>
              <Button
                component={RouterLink}
                endIcon={<ChevronRightIcon size={18} />}
                size="large"
                startIcon={<PortraitIcon size={18} />}
                sx={{
                  backdropFilter: "blur(8px)",
                  bgcolor: "rgba(255,253,248,0.58)",
                  borderColor: "rgba(168,116,29,0.34)",
                  borderRadius: "10px",
                  color: "#8C6423",
                  minHeight: 54,
                  minWidth: { sm: 278 },
                  px: 2.8,
                  "&:hover": {
                    bgcolor: "rgba(255,255,255,0.86)",
                    borderColor: "#A8741D",
                    color: "#6F4D19",
                    transform: "translateY(-1px)"
                  }
                }}
                to="/demo/jon-snow"
                variant="outlined"
              >
                Open Jon Snow Demo
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: { xs: 1.6, md: 2 },
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1.06fr" },
          alignItems: "stretch",
          maxWidth: 1680,
          mx: "auto",
          mt: { xs: 2.25, md: -7 },
          position: "relative",
          zIndex: 2
        }}
      >
        {actionCards.map((card) => (
          <Card
            aria-label={card.ariaLabel}
            component={RouterLink}
            key={card.to}
            to={card.to}
            sx={{
              // Milestone 14 visual-correction pass (PR #40, final light
              // feature-card asset integration): the real supplied
              // background asset (home-new-case-bg.png /
              // home-past-cases-bg.png), scrim-composited exactly the
              // way jon-snow-demo-card-bg.png is on the Jon Snow card --
              // opaque ivory over the text/metadata on the left, fading
              // out toward the right so the photo shows through where
              // there is no text to protect.
              backgroundColor: "#FFFDF8",
              // Readability correction (Home light-card pass): the
              // scrim's left/middle stops were raised so the text and
              // metadata row stay comfortably legible; the rightmost
              // stop is unchanged so the photo still shows clearly.
              backgroundImage: {
                xs:
                  "linear-gradient(90deg, rgba(255,253,248,0.99) 0%, rgba(255,253,248,0.97) 58%, rgba(255,253,248,0.7) 100%), " +
                  `url(${card.backgroundUrl})`,
                md:
                  "linear-gradient(90deg, rgba(255,253,248,0.99) 0%, rgba(255,253,248,0.97) 45%, rgba(255,253,248,0.64) 68%, rgba(255,253,248,0.2) 100%), " +
                  `url(${card.backgroundUrl})`
              },
              backgroundPosition: { xs: "64% center", md: "right center" },
              backgroundRepeat: "no-repeat",
              backgroundSize: "cover",
              borderColor: "rgba(196,168,120,0.5)",
              borderRadius: "14px",
              boxShadow: "0 20px 48px -28px rgba(70,53,28,0.46)",
              color: "inherit",
              display: "block",
              minHeight: { xs: 218, md: 154 },
              outline: "none",
              overflow: "hidden",
              position: "relative",
              textDecoration: "none",
              transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
              "&:before": {
                background:
                  `radial-gradient(circle at 82% 20%, ${card.accent}1c, transparent 45%), ` +
                  "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 30%, rgba(70,53,28,0.05) 100%)",
                content: '""',
                inset: 0,
                pointerEvents: "none",
                position: "absolute"
              },
              "&:hover": {
                borderColor: "rgba(168,116,29,0.62)",
                boxShadow: "0 24px 54px -28px rgba(70,53,28,0.56)",
                transform: "translateY(-2px)"
              },
              "&:focus-visible": {
                outline: "3px solid rgba(184,137,43,0.45)",
                outlineOffset: 3
              }
            }}
          >
            <Stack
              spacing={1}
              sx={{
                height: "100%",
                justifyContent: "space-between",
                p: { xs: 2.25, md: 2.05 },
                position: "relative",
                zIndex: 1
              }}
            >
              <Stack spacing={0.65}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <Typography
                    sx={{
                      color: card.accent,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap"
                    }}
                    variant="caption"
                  >
                    {card.eyebrow}
                  </Typography>
                  <Box sx={{ bgcolor: card.accent, flex: 1, height: "1px", opacity: 0.4 }} />
                </Stack>
                <Typography
                  component="h2"
                  sx={{
                    color: "#171514",
                    fontFamily: '"Fraunces", Georgia, serif',
                    fontSize: { xs: "1.5rem", md: "1.4rem" },
                    fontWeight: 650,
                    letterSpacing: 0,
                    lineHeight: 1.1
                  }}
                >
                  {card.title}
                </Typography>
                <Typography sx={{ color: "#3D362B", lineHeight: 1.4 }} variant="body2">
                  {card.description}
                </Typography>
              </Stack>

              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  borderColor: "rgba(196,168,120,0.4)",
                  borderTop: "1px solid",
                  justifyContent: "space-between",
                  pt: 1.1
                }}
              >
                <Stack direction="row" spacing={1.1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
                  {card.metadata.map((item, index) => (
                    <Stack direction="row" key={item.label} spacing={0.9} sx={{ alignItems: "center" }}>
                      {index > 0 ? (
                        <Box
                          sx={{
                            bgcolor: "rgba(150,120,60,0.32)",
                            display: { xs: "none", sm: "block" },
                            height: 14,
                            width: "1px"
                          }}
                        />
                      ) : null}
                      <Box sx={{ color: card.accent, display: "flex", flexShrink: 0 }}>
                        <item.icon size={16} />
                      </Box>
                      <Typography
                        sx={{ color: "#3D362B", fontSize: "0.74rem", fontWeight: 650, whiteSpace: "nowrap" }}
                      >
                        {item.label}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
                <Box
                  aria-hidden="true"
                  sx={{
                    alignItems: "center",
                    bgcolor: card.accent,
                    borderRadius: "50%",
                    color: "#FFFFFF",
                    display: "flex",
                    flexShrink: 0,
                    height: 34,
                    justifyContent: "center",
                    width: 34
                  }}
                >
                  <ChevronRightIcon size={18} />
                </Box>
              </Stack>
            </Stack>
          </Card>
        ))}
        <JonSnowHomeCard />
      </Box>

      <Box
        component="section"
        sx={{
          background:
            "linear-gradient(180deg, rgba(255,253,248,0.72), rgba(250,246,238,0.66))",
          border: "1px solid",
          borderColor: "rgba(196,168,120,0.55)",
          borderRadius: "13px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72)",
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
          maxWidth: 1680,
          mx: "auto",
          mt: { xs: 2.4, md: 2.2 },
          overflow: "hidden"
        }}
      >
        {stats.map((stat, index) => (
          <Box
            key={stat.label}
            sx={{
              borderColor: "divider",
              borderLeft: { md: index === 0 ? "none" : "1px solid" },
              borderLeftColor: { md: "rgba(168,146,108,0.46)" },
              borderTop: {
                xs: index === 0 ? "none" : "1px solid",
                sm: index < 2 ? "none" : "1px solid",
                md: "none"
              },
              p: { xs: 2.3, md: 2.7 }
            }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Box sx={{ color: "#B8892B", display: "flex", flexShrink: 0 }}>
                <stat.icon size={36} />
              </Box>
              <Stack spacing={0.4}>
                <Stack direction="row" spacing={1.1} sx={{ alignItems: "baseline" }}>
                  {stat.value ? (
                    <Typography
                      sx={{
                        color: "#171514",
                        fontFamily: '"Fraunces", Georgia, serif',
                        fontSize: { xs: "2rem", md: "2.4rem" },
                        fontWeight: 650,
                        letterSpacing: 0,
                        lineHeight: 0.9
                      }}
                    >
                      {stat.value}
                    </Typography>
                  ) : null}
                  <Typography
                    sx={{
                      color: "#171514",
                      fontFamily: '"Fraunces", Georgia, serif',
                      fontSize: { xs: "1.06rem", md: "1.18rem" },
                      fontWeight: 650,
                      letterSpacing: 0,
                      lineHeight: 1.1
                    }}
                  >
                    {stat.label}
                  </Typography>
                </Stack>
                <Typography color="text.secondary" variant="body2">
                  {stat.description}
                </Typography>
              </Stack>
            </Stack>
          </Box>
        ))}
      </Box>

      <Stack
        component="section"
        spacing={3}
        sx={{
          maxWidth: 1600,
          mx: "auto",
          pb: { xs: 1, md: 2 },
          pt: { xs: 3.4, md: 4.4 },
          width: "100%"
        }}
      >
        <Stack direction="row" spacing={3} sx={{ alignItems: "center", justifyContent: "center" }}>
          <Box
            sx={{
              background:
                "linear-gradient(90deg, rgba(184,137,43,0), rgba(184,137,43,0.8))",
              flex: 1,
              height: "1px",
              maxWidth: 250
            }}
          />
          <Typography
            component="h2"
            sx={{
              color: "#171514",
              fontFamily: '"Fraunces", Georgia, serif',
              fontSize: { xs: "1.65rem", md: "2rem" },
              fontWeight: 650,
              letterSpacing: 0,
              whiteSpace: "nowrap"
            }}
          >
            How it works
          </Typography>
          <Box
            sx={{
              background:
                "linear-gradient(90deg, rgba(184,137,43,0.8), rgba(184,137,43,0))",
              flex: 1,
              height: "1px",
              maxWidth: 250
            }}
          />
        </Stack>
        <Box
          sx={{
            display: "grid",
            gap: { xs: 2, md: 3 },
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }
          }}
        >
          {howItWorks.map((step, index) => (
            <Box
              key={step.title}
              sx={{
                background: "rgba(255,253,248,0.58)",
                border: "1px solid",
                borderColor: "rgba(196,168,120,0.52)",
                borderRadius: "12px",
                boxShadow: "0 16px 34px -30px rgba(70,53,28,0.42)",
                minHeight: 112,
                p: { xs: 2.3, md: 2.6 },
                position: "relative"
              }}
            >
              <Stack direction="row" spacing={2.1} sx={{ alignItems: "center" }}>
                <Stack direction="row" spacing={1.4} sx={{ alignItems: "center", flexShrink: 0 }}>
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
                    <step.icon size={42} />
                  </Box>
                </Stack>
                <Stack spacing={0.5}>
                  <Typography
                    component="h3"
                    sx={{
                      color: "#171514",
                      fontFamily: '"Fraunces", Georgia, serif',
                      fontSize: "1.08rem",
                      fontWeight: 650,
                      letterSpacing: 0,
                      lineHeight: 1.12
                    }}
                  >
                    {step.title}
                  </Typography>
                  <Typography color="text.secondary" sx={{ lineHeight: 1.42 }} variant="body2">
                    {step.description}
                  </Typography>
                </Stack>
              </Stack>
            </Box>
          ))}
        </Box>
      </Stack>
    </Box>
  );
}
