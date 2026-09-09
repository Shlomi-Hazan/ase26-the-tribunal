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
import { NavLink, useLocation } from "react-router-dom";
import { ClockHistoryIcon, HomeIcon, PlusSquareIcon, ScaleIcon } from "../components/icons/LineIcons";

const navItems = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/new/charge-sheet", label: "New Tribunal", icon: PlusSquareIcon },
  { to: "/history", label: "Past Cases", icon: ClockHistoryIcon }
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isHome = location.pathname === "/";

  return (
    <Box sx={{ minHeight: "100vh", overflowX: "hidden" }}>
      <AppBar
        component="header"
        elevation={0}
        position="sticky"
        sx={{
          bgcolor: "background.paper",
          border: "1px solid",
          borderBottom: "1px solid",
          borderColor: isHome ? "rgba(196,168,120,0.52)" : "divider",
          borderRadius: isHome ? { xs: 0, md: 2 } : 0,
          boxShadow: isHome ? "0 18px 46px -34px rgba(54,39,16,0.44)" : "none",
          color: "text.primary",
          left: isHome ? { md: 48 } : 0,
          maxWidth: isHome ? { md: "calc(100% - 96px)" } : "none",
          mx: isHome ? { md: "auto" } : 0,
          top: isHome ? { xs: 0, md: 14 } : 0,
          width: isHome ? { xs: "100%", md: "calc(100% - 96px)" } : "100%"
        }}
      >
        <Toolbar
          sx={{
            alignItems: { xs: "flex-start", sm: "center" },
            flexDirection: { xs: "column", sm: "row" },
            gap: { xs: 1.2, sm: isHome ? 4 : 3 },
            minHeight: isHome ? { sm: 72 } : undefined,
            px: isHome ? { xs: 2, md: 4 } : undefined,
            py: { xs: 1.5, sm: isHome ? 0.7 : 0 }
          }}
        >
          <Stack
            component={NavLink}
            direction="row"
            spacing={1.4}
            sx={{
              alignItems: "center",
              color: "text.primary",
              textDecoration: "none"
            }}
            to="/"
          >
            <Box
              sx={{
                alignItems: "center",
                border: "1px solid rgba(184,137,43,0.62)",
                color: "#9A6B21",
                display: "flex",
                height: 46,
                justifyContent: "center",
                width: 40
              }}
            >
              <ScaleIcon size={25} />
            </Box>
            <Typography
              variant="h6"
              sx={{
                fontFamily: '"Fraunces", Georgia, serif',
                fontSize: { xs: "1.35rem", md: isHome ? "1.78rem" : "1.35rem" },
                fontWeight: 650,
                letterSpacing: 0
              }}
            >
              The Tribunal
            </Typography>
          </Stack>
          <Stack
            aria-label="Primary navigation"
            component="nav"
            direction="row"
            spacing={isHome ? 0.8 : 1}
            sx={{
              flexWrap: "wrap",
              rowGap: 0.5
            }}
          >
            {navItems.map((item) => (
              <Link
                component={NavLink}
                end={item.to === "/"}
                key={item.to}
                to={item.to}
                sx={{
                  alignItems: "center",
                  borderBottom: "2px solid transparent",
                  borderRadius: isHome ? 1.5 : 0,
                  color: "text.secondary",
                  display: "inline-flex",
                  gap: 0.9,
                  fontWeight: 700,
                  px: isHome ? 1.6 : 0.5,
                  py: isHome ? 1 : 0.75,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  transition: "color 150ms ease, border-color 150ms ease, background-color 150ms ease",
                  "&:hover": {
                    bgcolor: isHome ? "rgba(184,137,43,0.06)" : "transparent",
                    color: "text.primary"
                  },
                  "&.active": {
                    borderBottomColor: "primary.dark",
                    color: "primary.dark"
                  },
                  "&:focus-visible": {
                    borderRadius: 1,
                    outline: "2px solid",
                    outlineColor: "primary.main",
                    outlineOffset: 2
                  }
                }}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            ))}
          </Stack>
          <Typography
            color="text.secondary"
            sx={{
              display: { xs: "none", lg: "block" },
              ml: { sm: "auto" },
              maxWidth: 260,
              textAlign: "right"
            }}
            variant="body2"
          >
            Educational AI deliberation — not legal advice.
          </Typography>
        </Toolbar>
      </AppBar>
      <Container
        component="main"
        maxWidth={isHome ? false : "lg"}
        sx={{
          px: isHome ? { xs: 2, sm: 3, md: 4 } : undefined,
          py: isHome ? { xs: 3, md: 5 } : { xs: 3, md: 5 }
        }}
      >
        {children}
      </Container>
    </Box>
  );
}
