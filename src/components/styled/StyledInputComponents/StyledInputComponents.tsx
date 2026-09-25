/** @format */

import styled from 'styled-components/native';

// Colours come from the ThemeProvider mounted in ReduxWrapper
// (`({ theme }) => theme.x`); the light palette holds the values that
// used to be hard-coded here.

export const InputContainer = styled.View<{ isText?: boolean }>`
  flex-direction: column;
  padding: 12px 16px 8px 16px;
  /* Transparent, so the dock's white surface — and its rounded top
   * corners — are what shows. An opaque child painted straight over those
   * corners (a parent's border radius does not clip children without
   * overflow:hidden, and that would clip the dock's shadow too). */
  background-color: transparent;
  z-index: 100;
  width: 100%;
  bottom: 0;
  left: 0;
  /* No radius or shadow here: the dock this sits in (ChatRoom's
   * InputDockTag) is the composer's outer surface and carries both. Having
   * them on this inner view too drew its shadow onto the dock's white
   * background — the faint seam that made the strip below look like a
   * different colour. */
`;

export const MediaContainer = styled.View`
  flex-direction: row;
  gap: 8px;
  padding: 0 16px 8px;
`;

export const MediaImage = styled.Image`
  width: 70px;
  height: 70px;
  border-radius: 8px;
`;

export const MessageInputContainer = styled.View`
  flex-direction: row;
  align-items: center;
  width: 100%;
  gap: 8px;
`;

export const MessageInput = styled.TextInput<{
  isFocused?: boolean;
  color?: string;
  fontSize?: number;
  fontWeight?: string;
}>`
  padding: 8px 14px;
  border-radius: 20px;
  border-width: 1px;
  border-color: ${({ isFocused, color, theme }) =>
    isFocused ? color || theme.primary : 'transparent'};
  color: ${({ theme }) => theme.text};
  font-size: ${({ fontSize }) => fontSize ?? 16}px;
  ${({ fontWeight }) => (fontWeight ? `font-weight: ${fontWeight};` : '')}
  background-color: ${({ theme }) => theme.surfaceSecondary};
  flex: 1;
  /* No explicit line-height: on iOS a line-height larger than the
     font's natural metrics drops the glyph to the bottom of the line
     box (looked like the text "sank"). Equal vertical padding + the
     natural line height centers single-line text in the min-height
     box. text-align-vertical / include-font-padding stay for Android. */
  text-align-vertical: center;
  include-font-padding: false;
`;

export const HiddenFileInput = styled.View``;

export const Timer = styled.Text`
  justify-content: center;
  align-items: center;
  margin-left: 10px;
`;

export const TimerText = styled.Text`
  font-size: 18px;
  font-weight: bold;
  color: ${({ theme }) => theme.text};
`;

export const WaveformContainer = styled.View`
  width: 100%;
  height: 40px;
  background-color: ${({ theme }) => theme.surfaceSecondary};
`;

export const RecordContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

export const FilePreviewContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
`;

export const FilePreview = styled.View`
  justify-content: center;
  align-items: center;
  width: 100px;
  height: 100px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.border};
  border-radius: 8px;
  background-color: ${({ theme }) => theme.surfaceSecondary};
  overflow: hidden;
`;

export const FileIcon = styled.Image`
  max-width: 80%;
  max-height: 80%;
`;

export const VideoPreview = styled.View`
  width: 100%;
  height: 100%;
`;

export const StyledInput = styled.TextInput`
  padding: 16px 12px;
  background-color: ${({ theme }) => theme.surfaceSecondary};
  color: ${({ theme }) => theme.text};
  font-size: 16px;
  border-radius: 16px;
`;

export const TextareaInput = styled.TextInput`
  padding: 16px 12px;
  background-color: ${({ theme }) => theme.surfaceSecondary};
  font-size: 16px;
  color: ${({ theme }) => theme.text};
  border-radius: 16px;
`;
