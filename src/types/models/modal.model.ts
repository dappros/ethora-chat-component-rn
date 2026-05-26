import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';

export type ModalType = (typeof MODAL_TYPES)[keyof typeof MODAL_TYPES];

export interface ModalFile {
  fileName: string;
  fileURL: string;
  mimetype: string;
}
