/** @format */

import 'styled-components/native';
import type { ChatTheme } from './theme';

declare module 'styled-components/native' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface DefaultTheme extends ChatTheme {}
}
