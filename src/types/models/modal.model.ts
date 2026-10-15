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
}
