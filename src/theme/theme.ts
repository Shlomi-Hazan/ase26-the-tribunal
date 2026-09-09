import { createTheme } from "@mui/material/styles";

// Milestone 14 -- "Ivory & Iron" design direction (Issue #39). The main
// product's token set: bright, warm, institutional. A real fallback
// stack is declared for every font role so text never renders invisible
// while Google Fonts loads (index.html sets font-display: swap).
const displayFontStack = '"Fraunces", Georgia, "Times New Roman", serif';
const bodyFontStack =
  '"Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const monoFontStack =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Locked contrast rule (independent design review): #B8892B (~2.93:1 on
// Ivory) is NEVER text -- decorative rules/icons/borders/the primary
// button's own background only. #8C6423 (~4.9:1 on Ivory, ~5.3:1 on
// white card surfaces) is the only gold used as text color. The primary
// button keeps dark Ink label text (~5.1:1 on Gold), never white.
const gold = "#B8892B";
const goldDeep = "#8C6423";
const ivory = "#FAF6EE";
const parchment = "#F1EAD9";
const ink = "#24211C";
const umber = "#6B6355";
const border = "#E4D9C2";

export const theme = createTheme({
  palette: {
    background: {
      default: ivory,
      paper: "#FFFFFF"
    },
    primary: {
      light: "#D3AE5C",
      main: gold,
      dark: goldDeep,
      // Explicit, never MUI's auto-contrast guess -- dark Ink on Gold
      // measures ~5.1:1 (AA), while MUI's own contrast heuristic could
      // otherwise pick white (~3.16:1, fails AA for normal-size text).
      contrastText: ink
    },
    secondary: {
      main: umber,
      contrastText: "#FFFFFF"
    },
    error: {
      main: "#A23B2E"
    },
    info: {
      main: "#4A6670"
    },
    success: {
      main: "#3F6E4E"
    },
    warning: {
      main: goldDeep
    },
    text: {
      primary: ink,
      secondary: umber
    },
    divider: border
  },
  typography: {
    fontFamily: bodyFontStack,
    h1: { fontFamily: displayFontStack, fontWeight: 600, letterSpacing: "-0.01em" },
    h2: { fontFamily: displayFontStack, fontWeight: 600, letterSpacing: "-0.005em" },
    h3: { fontFamily: displayFontStack, fontWeight: 600 },
    // h4/h5/h6 stay Public Sans -- serif is reserved for display-level
    // anchors only (Ivory & Iron's corrected wording), never every
    // heading level indiscriminately.
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
        a: {
          color: "inherit"
        },
        "html:focus-within": {
          scrollBehavior: "smooth"
        },
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
          border: `1px solid ${border}`,
          boxShadow: "0 1px 2px rgba(36,33,28,.04), 0 8px 24px rgba(36,33,28,.06)",
          backgroundImage: "none"
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
          transition: "transform 150ms ease, border-color 150ms ease, background-color 150ms ease",
          "&.MuiButton-containedPrimary:hover": {
            backgroundColor: goldDeep,
            color: "#FFFFFF"
          }
        },
        outlined: {
          borderColor: border,
          "&:hover": {
            borderColor: gold,
            backgroundColor: "rgba(184,137,43,0.06)"
          }
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600
        }
      }
    },
    MuiAlert: {
      // "Left-border-accented callouts, not full-color banner fills" --
      // Ivory & Iron §5. Same semantic severity color, muted fill,
      // 3px left border carrying the accent so a warning interrupts
      // attention without shouting.
      styleOverrides: {
        root: {
          borderRadius: 8,
          borderLeft: "3px solid currentColor",
          backgroundColor: parchment,
          color: ink,
          "&.MuiAlert-standardInfo": { borderLeftColor: "#4A6670" },
          "&.MuiAlert-standardSuccess": { borderLeftColor: "#3F6E4E" },
          "&.MuiAlert-standardWarning": { borderLeftColor: goldDeep },
          "&.MuiAlert-standardError": { borderLeftColor: "#A23B2E" }
        },
        icon: {
          opacity: 0.9
        }
      }
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          border: `1px solid ${border}`,
          boxShadow: "none",
          "&:before": { display: "none" }
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "#FFFFFF"
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: border
        }
      }
    }
  }
});
