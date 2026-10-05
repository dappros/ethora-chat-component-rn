import { IConfig } from '../types/types';
import { DEFAULT_QUICK_REACTIONS } from './emoji';

export const reactionsEnabled = (config?: IConfig | null): boolean =>
  !config?.disableReactions && config?.reactions?.enabled !== false;

export const quickReactionIds = (config?: IConfig | null): string[] => {
  const ids = config?.reactions?.quickReactions;
  return Array.isArray(ids) && ids.length ? ids.slice(0, 8) : DEFAULT_QUICK_REACTIONS;
};

export const reactionPickerEnabled = (config?: IConfig | null): boolean =>
  reactionsEnabled(config) && config?.reactions?.picker !== false;
