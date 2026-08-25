import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/**
 * A picked image in the shape React Native's FormData understands.
 *
 * NOT a web `File`: RN streams a multipart part straight from a `file://`
 * uri and has no usable Blob/File/atob path. Screens ported from the web
 * client used to carry base64 -> Blob -> File helpers that could never
 * have run here.
 */
export interface PickedImage {
  uri: string;
  type: string;
  name: string;
}

/**
 * Ask for library permission, open the picker, and normalise the result.
 *
 * Returns `null` for every non-error outcome — permission refused, user
 * cancelled — so call sites can simply keep their current value.
 *
 * Exists because the avatar pickers are wired to `onPress`, which hands
 * the callback a SyntheticEvent. Storing that event as "the image" (what
 * two screens used to do) rendered a pooled event as an <Image source>
 * and then crashed with "Property is not configurable" when React tried
 * to release it — on top of never letting the user pick anything.
 */
export const pickImageAsset = async (): Promise<PickedImage | null> => {
  try {
    // expo-image-picker owns the permission prompt internally and
    // returns a `granted` flag.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission required',
        'Photo library permission is needed to select images.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) {
      return null;
    }

    const asset = result.assets[0];
    const originalName = asset.fileName || asset.uri.split('/').pop();
    return {
      uri: asset.uri,
      type: asset.mimeType || 'image/jpeg',
      name: originalName || `image_${Date.now()}.jpg`,
    };
  } catch (error) {
    console.error('Failed to pick an image:', error);
    return null;
  }
};
