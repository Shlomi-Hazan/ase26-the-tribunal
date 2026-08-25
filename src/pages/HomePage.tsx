import { Box, Container, Stack, Typography } from "@mui/material";

export function HomePage() {
  return (
    <Container component="main" maxWidth="md">
      <Box
        sx={{
          alignItems: "center",
          display: "flex",
          minHeight: "100vh",
          py: 8
        }}
      >
        <Stack spacing={3}>
          <Typography
            component="p"
            sx={{ color: "text.secondary", fontWeight: 700, textTransform: "uppercase" }}
          >
            Agentic Software Engineering (ASE-26)
          </Typography>
          <Typography component="h1" variant="h2">
            The Tribunal
          </Typography>
          <Typography color="text.secondary" variant="h5">
            Application foundation is running.
          </Typography>
          <Typography color="text.secondary">
            This milestone establishes the executable shell and verification gate.
            Tribunal case execution begins in later milestones.
          </Typography>
        </Stack>
      </Box>
    </Container>
  );
}
