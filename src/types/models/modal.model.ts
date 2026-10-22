import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';

export type ModalType = (typeof MODAL_TYPES)[keyof typeof MODAL_TYPES];

export interface ModalFile {
  fileName: string;
  fileURL: string;
  mimetype: string;
  originalName?: string;
  duration?: number | string;
  waveForm?: string;
  /**
   * The other files of the album this one was opened from, this one
   * included, in order. With `index` it lets the viewer page through them.
   */
  siblings?: ModalFile[];
  /** Position of this file in `siblings`. */
  index?: number;
  /** The message the file came from, for the viewer's Reply and Delete. */
  source?: ModalFileSource;
  /** Poster frame of a video, for grids that show it before it plays. */
  previewURL?: string;
}

export interface ModalFileSource {
  messageId: string;
  roomJid: string;
  /** Sent by the signed-in user: the viewer offers Delete. */
  own?: boolean;
  /** The thread the viewer's Reply opens; absent where replies are off. */
  replyTo?: { id: string; chatJID: string };
  senderName?: string;
  /** When it was sent, ms since epoch. */
  timestamp?: number;
}
