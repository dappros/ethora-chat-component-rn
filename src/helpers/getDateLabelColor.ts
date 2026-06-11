export const getDateLabelColor = (config?: {
  colors?: { primary?: string; secondary?: string; dateLabel?: string };
}) => config?.colors?.dateLabel || config?.colors?.primary || '#0052CD';
