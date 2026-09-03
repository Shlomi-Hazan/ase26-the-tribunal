import {
  AppBar,
  Box,
  Container,
  Link,
  Stack,
  Toolbar,
  Typography
} from "@mui/material";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/new/charge-sheet", label: "New Case" },
  { to: "/history", label: "Past Cases" }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar
        component="header"
        elevation={0}
        position="sticky"
        sx={{
          bgcolor: "background.paper",
          borderBottom: "1px solid",
          borderColor: "divider",
          color: "text.primary"
        }}
      >
        <Toolbar
          sx={{
            alignItems: { xs: "flex-start", sm: "center" },
            flexDirection: { xs: "column", sm: "row" },
            gap: { xs: 1, sm: 3 },
            py: { xs: 1.5, sm: 0 }
          }}
        >
          <Typography component={NavLink} to="/" variant="h6" sx={{ textDecoration: "none" }}>
            The Tribunal
          </Typography>
          <Stack
            aria-label="Primary navigation"
            component="nav"
            direction="row"
            spacing={1}
          >
            {navItems.map((item) => (
              <Link
                component={NavLink}
                end={item.to === "/"}
                key={item.to}
                to={item.to}
                sx={{
                  borderRadius: 1,
                  color: "text.secondary",
                  fontWeight: 700,
                  px: 1.5,
                  py: 0.75,
                  textDecoration: "none",
                  "&.active": {
                    bgcolor: "rgba(143, 98, 56, 0.12)",
                    color: "text.primary"
                  },
                  "&:focus-visible": {
                    outline: "3px solid rgba(45, 95, 115, 0.45)",
                    outlineOffset: 2
                  }
                }}
              >
                {item.label}
              </Link>
            ))}
          </Stack>
          <Typography
            color="text.secondary"
            sx={{ ml: { sm: "auto" } }}
            variant="body2"
          >
            Educational AI deliberation — not legal advice.
          </Typography>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        {children}
      </Container>
    </Box>
  );
}
