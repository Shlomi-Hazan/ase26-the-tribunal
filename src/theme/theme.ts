import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    background: {
      default: "#f6f2e9",
      paper: "#fffdf7"
    },
    primary: {
      dark: "#142229",
      main: "#24343c"
    },
    secondary: {
      main: "#8f6238"
    },
    error: {
      main: "#9c2f2f"
    },
    info: {
      main: "#2d5f73"
    },
    success: {
      main: "#3f6f4f"
    },
    warning: {
      main: "#a97018"
    },
    text: {
      primary: "#172026",
      secondary: "#52605f"
    }
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h2: {
      fontWeight: 700,
      letterSpacing: 0
    },
    h3: {
      fontWeight: 700,
      letterSpacing: 0
    },
    h4: {
      fontWeight: 700,
      letterSpacing: 0
    },
    h5: {
      fontWeight: 700,
      letterSpacing: 0
    }
  },
  shape: {
    borderRadius: 8
  },
  components: {
    MuiButtonBase: {
      defaultProps: {
        disableRipple: true
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(36, 52, 60, 0.12)",
          boxShadow: "0 10px 30px rgba(23, 32, 38, 0.08)"
        }
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
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "#fffdf7"
        }
      }
    }
  }
});
