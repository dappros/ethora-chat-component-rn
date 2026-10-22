import { useCallback, useRef } from "react";
import { Alert, Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import type { ModalFile } from "../../../types/types";
import { withFileToken } from "../../../helpers/secureFileUrl";
import { getMediaLibrary } from "../../../helpers/mediaLibraryRuntime";
import { useToast } from "../../../context/ToastContext";
import { useT } from "../../../i18n/useT";
import {
  getDisplayFileName,
  getUniqueFileName,
  sanitizeFileNameForPath,
} from "../../../helpers/getDisplayFileName";

export const isLocalFile = (url: string | undefined | null) =>
  /^file:\/\//i.test(url || "");

const fetchToCache = async (url: string, cachePath: string) =>
  isLocalFile(url)
    ? { status: 200, uri: url }
    : FileSystem.downloadAsync(withFileToken(url), cachePath);

/**
 * Save button of the file viewers: pictures and videos to the gallery,
 * anything else to Downloads (Android, through SAF) or the share sheet (iOS).
 * Shared by the preview page and the media viewer opened from a chat profile.
 */
export const useSaveFile = () => {
  const { showToast } = useToast();
  const t = useT();
  // Cache the SAF directory the user granted so saving several documents
  // in a row doesn't re-prompt for a folder every time (Android only).
  const safDirUriRef = useRef<string | null>(null);

  return useCallback(
    async (activeFile: ModalFile) => {
      // Bug #40: prefer the sender's original name over the server's stored
      // hash name when saving/sharing the file. Sanitized so it's safe to use
      // as an actual path segment (strips path separators/control chars).
      const displayFileName = sanitizeFileNameForPath(
        getDisplayFileName({
          originalName: activeFile.originalName,
          fileName: activeFile.fileName,
          location: activeFile.fileURL,
          mimetype: activeFile.mimetype,
        })
      );

      const requestStoragePermission = async () => {
        const MediaLibrary = getMediaLibrary();
        if (!MediaLibrary?.requestPermissionsAsync) {
          return false;
        }
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          return status === "granted";
        } catch (error) {
          console.error("Error requesting permission:", error);
          return false;
        }
      };

      const saveToGallery = async () => {
        const hasPermission = await requestStoragePermission();
        if (!hasPermission) {
          Alert.alert(
            "Permission Denied",
            "Storage permission is required to save files to the gallery."
          );
          return;
        }

        try {
          const filePath = FileSystem.cacheDirectory + displayFileName;
          const download = await fetchToCache(activeFile.fileURL, filePath);

          if (download.status === 200) {
            await getMediaLibrary()?.saveToLibraryAsync(download.uri);
            showToast({
              id: Date.now().toString(),
              title: t("toast.successTitle"),
              message: t("toast.saveSuccessful"),
              type: "success",
            });
          } else {
            Alert.alert("Error", "Failed to save the file.");
          }
        } catch (err) {
          Alert.alert("Error", `Failed to save the file: ${displayFileName}`);
        }
      };

      // Best-effort existing-name lookup for the Android SAF branch below: SAF
      // hands back content URIs, not plain names, so this decodes each one and
      // takes its last path segment. If the provider's URI shape doesn't match
      // what we expect, we fail open (empty set) rather than block the save -
      // worst case we skip de-duplication, we never crash the save flow.
      const listSafDirectoryNames = async (
        saf: any,
        dirUri: string
      ): Promise<Set<string>> => {
        try {
          const uris: string[] = await saf.readDirectoryAsync(dirUri);
          const names = uris.map((uri) => {
            try {
              const decoded = decodeURIComponent(uri);
              const last = decoded.split("/").pop() || "";
              return last.includes(":") ? last.split(":").pop() || "" : last;
            } catch {
              return "";
            }
          });
          return new Set(names.filter(Boolean));
        } catch {
          return new Set<string>();
        }
      };

      const saveFileToDownloads = async () => {
        try {
          const filePath = FileSystem.cacheDirectory + displayFileName;
          const download = await fetchToCache(activeFile.fileURL, filePath);

          if (download.status !== 200) {
            Alert.alert("Error", "Failed to save the file.");
            return;
          }

          if (Platform.OS === "android") {
            const saf = (FileSystem as any).StorageAccessFramework;
            let dirUri = safDirUriRef.current;
            if (!dirUri) {
              const perm = await saf.requestDirectoryPermissionsAsync();
              if (!perm.granted) {
                Alert.alert(
                  "Permission Denied",
                  "Storage permission is required to save the file."
                );
                return;
              }
              dirUri = perm.directoryUri;
              safDirUriRef.current = dirUri;
            }

            // Avoid silently overwriting a different attachment that happens
            // to share the same display name (common now that we prefer the
            // human-picked name over the unique server hash - bug #40) by
            // suffixing " (1)", " (2)", ... on a collision.
            const existingNames = await listSafDirectoryNames(
              saf,
              dirUri as string
            );
            const uniqueName = await getUniqueFileName(
              displayFileName,
              async (candidate) => existingNames.has(candidate)
            );
            const baseName = uniqueName.replace(/\.[^/.]+$/, "");
            const mime = activeFile.mimetype || "application/octet-stream";
            const base64 = await FileSystem.readAsStringAsync(download.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const destUri = await saf.createFileAsync(dirUri, baseName, mime);
            await FileSystem.writeAsStringAsync(destUri, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });

            showToast({
              id: Date.now().toString(),
              title: t("toast.successTitle"),
              message: t("toast.saveSuccessful"),
              type: "success",
            });
            return;
          }

          // iOS (and any non-Android): there is no app-writable "Downloads"
          // folder, and MediaLibrary only accepts images/videos — which is why
          // documents previously hit the success toast without ever being
          // saved. Present the system share sheet so the user can "Save to
          // Files", AirDrop, etc. The sheet itself is the confirmation (the
          // user may cancel), so we don't show a "Save successful" toast here.
          await Share.share({
            url: download.uri,
            title: displayFileName,
          });
        } catch (err) {
          console.error("Error saving file:", err);
          Alert.alert("Error", "Failed to save the file.");
        }
      };

      const saveClick = async () => {
        if (
          activeFile.mimetype.startsWith("image/") ||
          activeFile.mimetype.startsWith("video/")
        ) {
          await saveToGallery();
        } else {
          await saveFileToDownloads();
        }
      };

      await saveClick();
    },
    [showToast, t]
  );
};
