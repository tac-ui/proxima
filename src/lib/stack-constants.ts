export const statusVariantMap: Record<string, "success" | "destructive" | "warning" | "info" | "secondary"> = {
  running: "success",
  exited: "destructive",
  created: "warning",
  partial: "warning",
  unknown: "secondary",
};

export const statusLabelMap: Record<string, string> = {
  running: "Running",
  exited: "Exited",
  created: "Created",
  partial: "Partial",
  unknown: "Unknown",
};
