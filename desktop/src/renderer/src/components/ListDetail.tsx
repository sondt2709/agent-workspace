// The list and detail layout of the Devices, Knowledge and Files screens (docs/phase-1.md 10.12):
// below 840 px the detail replaces the list and has a Back button; from 840 px both show side by
// side. The selection is in the route, so the screen calls `onBack` to clear it.
import ArrowBack from "@mui/icons-material/ArrowBackOutlined";
import { Box, Button, useMediaQuery, type Theme } from "@mui/material";
import type { ReactNode } from "react";

export function ListDetail(props: {
  list: ReactNode;
  detail: ReactNode;
  /** True when an item is selected: a narrow window then shows the detail only. */
  selected: boolean;
  onBack: () => void;
  listWidth?: number;
}) {
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"));
  if (!wide) {
    return (
      <Box sx={{ height: "100%", overflowY: "auto" }}>
        {props.selected ? (
          <>
            <Button startIcon={<ArrowBack />} onClick={props.onBack} sx={{ m: 2 }}>
              Back
            </Button>
            {props.detail}
          </>
        ) : (
          props.list
        )}
      </Box>
    );
  }
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `${props.listWidth ?? 300}px minmax(0, 1fr)`,
        height: "100%",
        minHeight: 0,
      }}
    >
      <Box sx={{ overflowY: "auto", borderRight: 1, borderColor: "divider" }}>{props.list}</Box>
      <Box sx={{ overflowY: "auto", minWidth: 0 }}>{props.detail}</Box>
    </Box>
  );
}
