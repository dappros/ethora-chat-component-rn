/**
 * The save button's alerts (FilePreviewModal/useSaveFile) follow the UI
 * language: they were English literals, so a French or Spanish reader who
 * denied photo access got "Permission Denied" in English.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Platform } from 'react-native';

let mockLocale = 'fr';
let mockPermission = 'denied';
const mockSaveToLibrary = jest.fn(() => Promise.reject(new Error('disk full')));

jest.mock('../src/hooks/useChatSettingState', () => ({
  useChatSettingState: () => ({ config: { i18n: { locale: mockLocale } } }),
}));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('../src/helpers/mediaLibraryRuntime', () => ({
  getMediaLibrary: () => ({
    requestPermissionsAsync: () => Promise.resolve({ status: mockPermission }),
    saveToLibraryAsync: mockSaveToLibrary,
  }),
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: jest.fn(() => Promise.resolve({ status: 404, uri: '' })),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  },
}));

import { useSaveFile } from '../src/components/Modals/FilePreviewModal/useSaveFile';
import type { ModalFile } from '../src/types/types';

const image = {
  fileURL: 'file:///photos/beach.jpg',
  fileName: 'beach.jpg',
  originalName: 'beach.jpg',
  mimetype: 'image/jpeg',
} as ModalFile;
const pdf = {
  fileURL: 'https://files.example.com/report.pdf',
  fileName: 'report.pdf',
  originalName: 'report.pdf',
  mimetype: 'application/pdf',
} as ModalFile;

const save = async (file: ModalFile) => {
  let saveFile: ((f: ModalFile) => Promise<void>) | undefined;
  const Probe = () => {
    saveFile = useSaveFile();
    return null;
  };
  await act(async () => {
    renderer.create(<Probe />);
  });
  await act(async () => {
    await saveFile!(file);
  });
};

describe('useSaveFile alerts follow the UI language', () => {
  let alert: jest.SpyInstance;
  const os = Platform.OS;

  beforeEach(() => {
    mockLocale = 'fr';
    mockPermission = 'denied';
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Platform.OS = os;
  });

  it('photo access denied: French', async () => {
    await save(image);
    expect(alert).toHaveBeenCalledWith(
      'Autorisation refusée',
      "L'autorisation d'accès au stockage est nécessaire pour enregistrer des fichiers dans la galerie."
    );
  });

  it('photo access denied: Spanish', async () => {
    mockLocale = 'es';
    await save(image);
    expect(alert).toHaveBeenCalledWith(
      'Permiso denegado',
      'Se necesita permiso de almacenamiento para guardar archivos en la galería.'
    );
  });

  it('English stays as it was', async () => {
    mockLocale = 'en';
    await save(image);
    expect(alert).toHaveBeenCalledWith(
      'Permission denied',
      'Storage permission is required to save files to the gallery.'
    );
  });

  it('a gallery save that throws names the file', async () => {
    mockPermission = 'granted';
    await save(image);
    expect(alert).toHaveBeenCalledWith(
      'Erreur',
      "Impossible d'enregistrer le fichier : beach.jpg"
    );
  });

  it('a failed download', async () => {
    await save(pdf);
    expect(alert).toHaveBeenCalledWith('Erreur', "Impossible d'enregistrer le fichier.");
  });

  it('Android: folder access denied', async () => {
    Platform.OS = 'android';
    const fs = require('expo-file-system/legacy');
    fs.downloadAsync.mockImplementationOnce(() =>
      Promise.resolve({ status: 200, uri: 'file:///cache/report.pdf' })
    );
    await save(pdf);
    expect(alert).toHaveBeenCalledWith(
      'Autorisation refusée',
      "L'autorisation d'accès au stockage est nécessaire pour enregistrer le fichier."
    );
  });
});
