import { Stack, Typography } from "@mui/material";

export function PageHeader({
  eyebrow,
  title,
  description
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <Stack spacing={1}>
      {eyebrow ? (
        <Typography
          component="p"
          sx={{
            color: "secondary.main",
            fontWeight: 800,
            textTransform: "uppercase"
          }}
        >
          {eyebrow}
        </Typography>
      ) : null}
      <Typography component="h1" variant="h3">
        {title}
      </Typography>
      <Typography color="text.secondary">{description}</Typography>
    </Stack>
  );
}
