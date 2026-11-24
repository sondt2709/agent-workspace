// The Setup check page (openspec gap-install, setup-check: desktop setup check; prd DEV-10, AGT-14):
// the checks of `GET /v1/doctor` with each fix, the Claude sign-in step and the plan-limit text.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import type { DoctorCheck } from "../../../shared/channels.ts";
import { call, errorText } from "../bridge.ts";

/** The text of prd AGT-14. */
export const PLAN_LIMIT_TEXT =
  "A plan has a 5-hour limit and a weekly limit. One agent that works day and night uses more than a Pro or Max plan gives. For heavy 24/7 work, use an API key.";

const STATUS: Record<
  DoctorCheck["status"],
  { label: string; color: "success" | "warning" | "error" | "default" }
> = {
  ok: { label: "OK", color: "success" },
  warn: { label: "Warning", color: "warning" },
  fail: { label: "Failed", color: "error" },
  skip: { label: "Skipped", color: "default" },
};

export const doctorKey = ["aw", "doctor"] as const;

function CheckRow({ check }: { check: DoctorCheck }) {
  const status = STATUS[check.status];
  return (
    <ListItem divider alignItems="flex-start" data-check={check.id}>
      <Chip
        size="small"
        label={status.label}
        color={status.color}
        sx={{ mr: 2, mt: 0.5, minWidth: 80 }}
      />
      <ListItemText
        primary={check.title}
        secondary={
          <>
            <Typography component="span" variant="body2" sx={{ display: "block" }}>
              {check.detail}
            </Typography>
            {check.fix && (
              <Typography
                component="span"
                variant="body2"
                sx={{ display: "block", color: "text.primary" }}
              >
                Fix: {check.fix}
              </Typography>
            )}
          </>
        }
      />
    </ListItem>
  );
}

export function SetupCheckPage() {
  const doctor = useQuery({ queryKey: doctorKey, queryFn: () => call("doctor", {}) });
  const data = doctor.data;
  const login = data?.checks.find((c) => c.id === "claude_login");
  return (
    <Box sx={{ overflowY: "auto", height: "100%" }}>
      <Stack spacing={3} sx={{ p: 4, maxWidth: 880, mx: "auto" }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="h2" sx={{ flex: 1 }}>
            Setup check
          </Typography>
          <Button
            variant="outlined"
            disabled={doctor.isFetching}
            onClick={() => void doctor.refetch()}
          >
            Check again
          </Button>
        </Stack>
        {doctor.isFetching && <LinearProgress aria-label="Checking" />}
        {doctor.isError && <Alert severity="error">{errorText(doctor.error)}</Alert>}
        {data && (
          <Alert severity={data.ok ? "success" : "error"}>
            {data.ok
              ? `${data.device} is ready.`
              : `${data.device} has ${data.checks.filter((c) => c.status === "fail").length} failed checks. Do the fix of each one, then check again.`}
          </Alert>
        )}
        {data && (
          <Card>
            <List disablePadding aria-label="Checks">
              {data.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </List>
          </Card>
        )}
        <Card>
          <CardContent>
            <Typography variant="subtitle1">Sign in to Claude Code</Typography>
            <Typography variant="body2" color="text.secondary">
              {login?.status === "ok"
                ? "Claude Code is signed in on this device."
                : "Open a terminal on this device, run claude, and sign in. Then click Check again. Do the same on each computer that runs agents."}
            </Typography>
            <Typography variant="subtitle1" sx={{ mt: 2 }}>
              Plan limits
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {PLAN_LIMIT_TEXT}
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
