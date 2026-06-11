export const getSenderNameColor = (config?: {
  colors?: { primary?: string; secondary?: string; senderName?: string };
}) => config?.colors?.senderName || config?.colors?.primary || '#0052CD';
