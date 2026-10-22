import { createContext, useContext } from 'react';
import type { ModalFileSource } from '../types/types';

/**
 * The message a bubble's pictures and videos belong to. MediaMessage provides
 * it, and the image / video / album components that open the viewer read it,
 * so the viewer knows what its Reply and Delete act on without every card in
 * between passing the message along.
 */
const MediaSourceContext = createContext<ModalFileSource | undefined>(undefined);

export const MediaSourceProvider = MediaSourceContext.Provider;

export const useMediaSource = () => useContext(MediaSourceContext);
