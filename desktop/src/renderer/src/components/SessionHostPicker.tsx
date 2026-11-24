// The session host choice of the dialogs New session and "Assign to another device…" (integrate-ui):
// tmux, or Orca when the device turned it on (docs/phase-1.md 9.9.6). The dialog sends the chosen
// host as `session_host` in the assign call.
import { FormControlLabel, Radio, RadioGroup, Stack, Typography } from "@mui/material";
import type { SessionHostChoice, SessionHostName } from "../devices-model.ts";

/** The host to send: the person's choice, else the initial one, and never a disabled Orca. */
export function chosenHost(choice: SessionHostChoice, picked: SessionHostName | null) {
  const host = picked ?? choice.initial;
  return host === "orca" && !choice.orcaEnabled ? "tmux" : host;
}

/**
 * The `session_host` that a dialog sends: the shown host when the host list loaded or the person
 * picked one, else none. awd keeps the asked host of a task for its later sessions, so a default
 * that the dialog shows while the list loads or after it fails must not go into the log (fix list
 * 0-11): with no host, awd uses the checkout binding and "Use Orca".
 */
export function sentHost(
  choice: SessionHostChoice,
  picked: SessionHostName | null,
  loaded: boolean,
): SessionHostName | undefined {
  return loaded || picked !== null ? chosenHost(choice, picked) : undefined;
}

export function SessionHostPicker(props: {
  choice: SessionHostChoice;
  value: SessionHostName;
  onChange: (host: SessionHostName) => void;
  disabled?: boolean;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary" id="session-host-label">
        Session host
      </Typography>
      <RadioGroup
        aria-labelledby="session-host-label"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as SessionHostName)}
      >
        <FormControlLabel
          value="tmux"
          control={<Radio />}
          disabled={props.disabled}
          label="tmux · default"
        />
        <FormControlLabel
          value="orca"
          control={<Radio />}
          disabled={props.disabled || !props.choice.orcaEnabled}
          label={props.choice.orcaLabel}
        />
      </RadioGroup>
      {props.choice.note && (
        <Typography variant="caption" color="text.secondary">
          {props.choice.note}
        </Typography>
      )}
    </Stack>
  );
}
