import http from '../apiClient';
import { normalizeApiPath } from '../apiClient';
import { store } from '../../roomStore';
import { User } from '../../types/types';

interface GetMyUserOptions {
  token?: string;
  endpoint?: string;
}

export async function getMyUser(options?: GetMyUserOptions): Promise<User> {
  const token =
    options?.token || store.getState().chatSettingStore.user.token || '';
  const endpoint = normalizeApiPath(options?.endpoint) || '/v1/users/my';

  const response = await http.get(endpoint, {
    headers: { Authorization: token },
  });

  if (response?.data?.user) {
    return response.data.user as User;
  }
  return response.data as User;
}

export function getDocuments(walletAddress: string) {
  const token = store.getState().chatSettingStore.user.token || '';
  return http.get(`/v1/docs/${walletAddress}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export function getExportMyData() {
  const token = store.getState().chatSettingStore.user.token || '';
  return http.get('/v1/users/exportData', {
    headers: {
      Authorization: token,
      responseType: 'arraybuffer',
    },
  });
}

export function deleteDocument(fileId: string) {
  const token = store.getState().chatSettingStore.user.token || '';
  return http.delete(`/v1/files/${fileId}`, {
    headers: {
      Authorization: token,
    },
  });
}

export function deleteMe() {
  return http.delete('/v1/users');
}

export function updateMe(data: any) {
  return http.put('/v1/users', data);
}

export async function updateProfile(fd: FormData): Promise<{ user: User }> {
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.put('/v1/users', fd, {
      headers: {
        Authorization: token,
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error) {
    throw new Error('Error updating profile');
  }
}

/** One entry of `GET /v2/files/`, normalised for the UI. */
export interface UserFile {
  id: string;
  name: string;
  url: string;
  mimetype: string;
  createdAt?: string;
  size?: number;
}

/**
 * Files uploaded by the signed-in user (the JWT owner) — the profile
 * screen's Media and Documents tabs.
 *
 * v2 answers `{ results, pagination }` and, for backward compatibility,
 * also `{ limit, offset, total, items }`; older deployments only have the
 * legacy shape. Read whichever is there instead of betting on one. Field
 * names vary the same way between deployments (`location` vs `locations[]`,
 * `originalname` vs `filename`), so each one falls through its aliases and
 * anything without a usable URL is dropped rather than rendered as a dead
 * row.
 */
export async function getUserFiles(options?: {
  limit?: number;
  offset?: number;
}): Promise<UserFile[]> {
  const token = store.getState().chatSettingStore.user.token || '';
  const response = await http.get('/v2/files/', {
    params: {
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    },
    headers: { Authorization: token },
  });

  const payload = response?.data ?? {};
  const rows: any[] = payload.results ?? payload.items ?? [];

  return rows
    .map((row: any): UserFile | null => {
      const url = row?.location || row?.locations?.[0] || row?.url || '';
      if (!url) {return null;}
      return {
        id: String(row?._id ?? row?.id ?? url),
        name:
          row?.originalname ||
          row?.filename ||
          row?.documentName ||
          row?.name ||
          url.split('/').pop() ||
          'file',
        url,
        mimetype: row?.mimetype || row?.mimeType || row?.type || '',
        createdAt: row?.createdAt || row?.updatedAt,
        size: typeof row?.size === 'number' ? row.size : undefined,
      };
    })
    .filter(Boolean) as UserFile[];
}

/** Images and video go to the Media tab, everything else to Documents. */
export const isMediaFile = (file: UserFile): boolean => {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/')) {return true;}
  if (mime) {return false;}
  // Deployments that don't store a mimetype still name the file.
  return /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov|m4v|3gp|avi|mkv)$/i.test(
    file.name
  );
};
