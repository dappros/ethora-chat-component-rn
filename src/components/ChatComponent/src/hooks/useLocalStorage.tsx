import AsyncStorage from '@react-native-async-storage/async-storage';

export function useLocalStorage<T>(key: string) {
  const get = async (): Promise<T | null> => {
    try {
      const storedValue = await AsyncStorage.getItem(key);
      if (!storedValue) return null;
      return JSON.parse(storedValue) as T;
    } catch (error) {
      console.error('Failed to parse AsyncStorage value', error);
      return null;
    }
  };

  const set = async (value: T) => {
    try {
      const stringValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, stringValue);
    } catch (error) {
      console.error('Failed to store value in AsyncStorage', error);
    }
  };

  const remove = async () => {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to remove value from AsyncStorage', error);
    }
  };

  return {get, set, remove};
}
