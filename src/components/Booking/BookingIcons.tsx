import React from 'react';
import Svg, { Line, Rect } from 'react-native-svg';

interface IconProps {
  color?: string;
  size?: number;
}

/** Calendar glyph for the header's "Schedule a call" button. */
export const ScheduleCallIcon: React.FC<IconProps> = ({
  color = '#000000',
  size = 22,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect
      x="3.5"
      y="5"
      width="17"
      height="15.5"
      rx="2.5"
      stroke={color}
      strokeWidth={1.8}
    />
    <Line x1="3.5" y1="10" x2="20.5" y2="10" stroke={color} strokeWidth={1.8} />
    <Line
      x1="8"
      y1="3"
      x2="8"
      y2="6.5"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
    <Line
      x1="16"
      y1="3"
      x2="16"
      y2="6.5"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
  </Svg>
);
