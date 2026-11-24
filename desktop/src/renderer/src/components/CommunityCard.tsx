// The "Sync across networks" section of Settings (openspec gap-setup, prd SYN-06, decision D18): the plain text about
// the community discovery and relay servers, and the switch "LAN and Tailscale only".
import { Alert, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import { errorText } from "../bridge.ts";
import { useSetCommunity, useSyncSettings } from "../setup-queries.ts";
import { Section } from "./common.tsx";

export function CommunityCard() {
  const settings = useSyncSettings();
  const set = useSetCommunity();
  const data = settings.data;
  return (
    <Section title="Sync across networks">
      <Stack spacing={2}>
        {settings.isError && <Alert severity="error">{errorText(settings.error)}</Alert>}
        {data && (
          <>
            <Typography variant="body2" color="text.secondary">
              {data.text}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={data.community}
                  disabled={data.source === "env" || set.isPending}
                  onChange={(e) => set.mutate(e.target.checked)}
                />
              }
              label="Use community discovery and relay servers"
            />
            <Typography variant="body2" color="text.secondary">
              {data.community
                ? "On: your devices find each other on any network."
                : "LAN and Tailscale only: your devices sync on the same LAN or over Tailscale."}
            </Typography>
            {data.source === "env" && (
              <Alert severity="info">
                AW_SYNC_COMMUNITY sets this switch on this computer. Remove the variable from the
                awd environment to change it here.
              </Alert>
            )}
            {set.data?.applied === "next_start" && (
              <Alert severity="info">The sync engine gets the change at its next start.</Alert>
            )}
            {set.isError && <Alert severity="error">{errorText(set.error)}</Alert>}
          </>
        )}
      </Stack>
    </Section>
  );
}
