import { Box, Button, Container, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

export function NotFoundPage() {
  return (
    <Container component="main" maxWidth="sm">
      <Box
        sx={{
          alignItems: "center",
          display: "flex",
          minHeight: "100vh",
          py: 8
        }}
      >
        <Stack spacing={3}>
          <Typography component="h1" variant="h3">
            Page not found
          </Typography>
          <Typography color="text.secondary">
            The requested route is not part of the Tribunal mock UI shell.
          </Typography>
          <Button component={RouterLink} to="/" variant="contained">
            Return home
          </Button>
        </Stack>
      </Box>
    </Container>
  );
}
