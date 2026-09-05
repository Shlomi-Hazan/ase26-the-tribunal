import { createTheme } from "@mui/material/styles";

// Milestone 14 -- "Ivory & Iron," the Jon Snow demo's one dark chamber
// (Issue #39 Phase 4). Same shape language as theme.ts (radius, card
// border/shadow treatment, button/alert component overrides) -- only
// the palette changes, so the two themes read as one product lit
// differently, never a different vendor. Route-scoped only (see
// src/app/AppThemeProvider.tsx); never persisted, never inferred from
// case/defendant content.
const displayFontStack = '"Fraunces", Georgia, "Times New Roman", serif';
const bodyFontStack =
  '"Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const night = "#0B0F14";
const iron = "#161B22";
const ironBorder = "#2A323D";
const frost = "#D8DEE6";
const steel = "#7C8695";
// Locked contrast rule (independent design review): #4C7A9E is the
// approved THEMATIC blue for borders/icons/small accents -- never
// behind text (white-on-#4C7A9E measures ~4.58:1, and the illustrative
// gradient's lighter stop measured ~3.66:1; both fail or barely scrape
// AA). The one CTA that carries text uses this independently verified,
// slightly deepened fill instead (white-on-#3D6B8C measures ~5.7:1).
export const jonSnowCtaBlue = "#3D6B8C";
const valyrianBlue = "#4C7A9E";
const direBronze = "#A98548";

export const jonSnowTheme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: night,
      paper: iron
    },
    primary: {
      main: jonSnowCtaBlue,
      light: valyrianBlue,
      dark: "#2E5A78",
      contrastText: "#FFFFFF"
    },
    secondary: {
      main: direBronze,
      contrastText: night
    },
    error: {
      main: "#C4695C"
    },
    info: {
      main: valyrianBlue
    },
    success: {
      main: "#5E9873"
    },
    warning: {
      main: direBronze
    },
    text: {
      primary: frost,
      secondary: steel
    },
    divider: ironBorder
  },
  typography: {
    fontFamily: bodyFontStack,
    h1: { fontFamily: displayFontStack, fontWeight: 600, letterSpacing: "-0.01em" },
    h2: { fontFamily: displayFontStack, fontWeight: 600, letterSpacing: "-0.005em" },
    h3: { fontFamily: displayFontStack, fontWeight: 600 },
    h4: { fontWeight: 700, letterSpacing: 0 },
    h5: { fontWeight: 700, letterSpacing: 0 },
    h6: { fontWeight: 700, letterSpacing: 0 }
  },
  shape: {
    borderRadius: 12
  },
  components: {
    MuiButtonBase: {
      defaultProps: {
        disableRipple: true
      }
    },
    MuiCssBaseline: {
      styleOverrides: {
        a: { color: "inherit" },
        "html:focus-within": { scrollBehavior: "smooth" },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
            transitionDuration: "0.01ms !important"
          }
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: `1px solid ${ironBorder}`,
          backgroundColor: iron,
          backgroundImage: "none",
          boxShadow: "0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35)"
        }
      }
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true
      },
      styleOverrides: {
        root: {
          fontWeight: 600,
          textTransform: "none",
          transition: "transform 150ms ease, border-color 150ms ease, background-color 150ms ease"
        },
        outlined: {
          borderColor: ironBorder,
          "&:hover": {
            borderColor: valyrianBlue,
            backgroundColor: "rgba(76,122,158,0.1)"
          }
        }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          borderLeft: "3px solid currentColor",
          backgroundColor: iron,
          color: frost,
          "&.MuiAlert-standardInfo": { borderLeftColor: valyrianBlue },
          "&.MuiAlert-standardSuccess": { borderLeftColor: "#5E9873" },
          "&.MuiAlert-standardWarning": { borderLeftColor: direBronze },
          "&.MuiAlert-standardError": { borderLeftColor: "#C4695C" }
        }
      }
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          border: `1px solid ${ironBorder}`,
          backgroundColor: iron,
          backgroundImage: "none",
          boxShadow: "none",
          "&:before": { display: "none" }
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: iron
        }
      }
    },
    // No MuiAppBar override: AppShell's own sx already sets
    // `bgcolor: "background.paper"` on the AppBar (the same rule the
    // light theme relies on), which resolves to `iron` here -- visually
    // distinct from the `night` page background behind it, exactly the
    // same paper-vs-default relationship the light theme already uses.
    // A component-level override here would just be unreachable dead
    // code sitting behind that sx.
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: ironBorder
        }
      }
    }
  }
});
