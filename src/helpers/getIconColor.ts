export const getIconColor = (config?: {
  colors?: { primary?: string; secondary?: string; icon?: string };
}) => config?.colors?.icon || config?.colors?.primary || '#0052CD';
