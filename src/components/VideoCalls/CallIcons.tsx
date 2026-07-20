import React from 'react';
import Svg, { Path, Rect, Line, Circle } from 'react-native-svg';

/**
 * Call-control glyph set, 24px, mirrored from the web SDK's inline icons
 * (components/VideoCalls/VideoCallSession.tsx) so the two platforms read
 * the same. The "off" variants overlay a diagonal slash: a thick `cutColor`
 * line under a thin icon-color line, so the slash stays legible against the
 * glyph on any button background.
 *
 * Hosts can replace any of these through `config.videoCalls.icons`.
 */

interface IconProps {
  color?: string;
  cutColor?: string;
  size?: number;
}

const DANGER = '#E53935';

const Slash: React.FC<{ color: string; cutColor: string }> = ({
  color,
  cutColor,
}) => (
  <>
    <Line
      x1="3"
      y1="3"
      x2="21"
      y2="21"
      stroke={cutColor}
      strokeWidth={4}
      strokeLinecap="round"
    />
    <Line
      x1="3"
      y1="3"
      x2="21"
      y2="21"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </>
);

export const MicOnIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="8.5" y="2" width="7" height="12" rx="3.5" fill={color} />
    <Path
      d="M5 11a7 7 0 0 0 14 0"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      fill="none"
    />
    <Line
      x1="12"
      y1="18"
      x2="12"
      y2="22"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </Svg>
);

export const MicOffIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  cutColor = DANGER,
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="8.5" y="2" width="7" height="12" rx="3.5" fill={color} />
    <Path
      d="M5 11a7 7 0 0 0 14 0"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      fill="none"
    />
    <Line
      x1="12"
      y1="18"
      x2="12"
      y2="22"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Slash color={color} cutColor={cutColor} />
  </Svg>
);

export const CameraOnIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="2" y="6" width="13" height="12" rx="3" fill={color} />
    <Path d="M15 11l6-3.5v9L15 13v-2z" fill={color} />
  </Svg>
);

export const CameraOffIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  cutColor = DANGER,
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="2" y="6" width="13" height="12" rx="3" fill={color} />
    <Path d="M15 11l6-3.5v9L15 13v-2z" fill={color} />
    <Slash color={color} cutColor={cutColor} />
  </Svg>
);

export const HangUpIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M2.5 14.2c-.7-.7-.6-1.9.2-2.5C5 9.9 8.4 8.9 12 8.9s7 1 9.3 2.8c.8.6.9 1.8.2 2.5l-1.6 1.6c-.6.6-1.5.7-2.2.2l-2-1.4a1.7 1.7 0 0 1-.7-1.4v-1.1c-1-.3-2-.4-3-.4s-2 .1-3 .4v1.1c0 .6-.3 1.1-.7 1.4l-2 1.4c-.7.5-1.6.4-2.2-.2l-1.6-1.6z"
      fill={color}
    />
  </Svg>
);

export const AudioCallIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M6.6 2h2.2c.5 0 .9.3 1 .8l.9 3.4c.1.4 0 .8-.4 1.1L8.7 8.6a13 13 0 0 0 6.7 6.7l1.3-1.6c.3-.3.7-.5 1.1-.4l3.4.9c.5.1.8.5.8 1v2.2c0 1.4-1.2 2.6-2.6 2.5A18.4 18.4 0 0 1 2.1 4.6C2 3.2 3.2 2 4.6 2h2z"
      fill={color}
    />
  </Svg>
);

export const VideoCallIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="2" y="6" width="13" height="12" rx="3" fill={color} />
    <Path d="M15 11l6-3.5v9L15 13v-2z" fill={color} />
  </Svg>
);

export const SwitchCameraIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 4h6l1.2 2H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.8L9 4z"
      stroke={color}
      strokeWidth={1.8}
      fill="none"
      strokeLinejoin="round"
    />
    <Path
      d="M9.5 12.5A2.5 2.5 0 0 1 14 11m.5 2.5A2.5 2.5 0 0 1 10 15"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      fill="none"
    />
    <Path d="M14 9.5V11h-1.5M10 16.5V15h1.5" stroke={color} strokeWidth={1.8} />
  </Svg>
);

export const SpeakerIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 9h3l4-4v14l-4-4H4V9z" fill={color} />
    <Path
      d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      fill="none"
    />
  </Svg>
);

export const SpeakerOffIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  cutColor = DANGER,
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 9h3l4-4v14l-4-4H4V9z" fill={color} />
    <Slash color={color} cutColor={cutColor} />
  </Svg>
);

export const MinimizeIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M5 14h5v5M19 10h-5V5"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);

export const ExpandIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 4H4v5M15 20h5v-5"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);

export const PersonIcon: React.FC<IconProps> = ({
  color = '#FFFFFF',
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="8" r="4" fill={color} />
    <Path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill={color} />
  </Svg>
);
