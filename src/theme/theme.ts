import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    background: {
      default: "#f7f7f2"
    },
    primary: {
      main: "#203a43"
    },
    secondary: {
      main: "#8b5e34"
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
    }
  },
  shape: {
    borderRadius: 8
  }
});
