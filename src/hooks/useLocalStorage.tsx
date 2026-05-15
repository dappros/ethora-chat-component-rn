import AsyncStorage from '@react-native-async-storage/async-storage';

// NOTE: This is misnamed — it's a plain helper, not a React hook. It's
// invoked from reducers (chatSettingsSlice.setUser/refreshTokens/logout)
// and from `resolveInitBeforeLoadUser`, neither of which are inside a
// React render. `useCallback`/`useState` etc. would throw "null reading
// useCallback" outside a render. Keep these as straight functions.
export function useLocalStorage<T>(key: string) {
  const get = async (): Promise<T | null> => {
    try {
      const storedValue = await AsyncStorage.getItem(key);
      if (!storedValue) return null;
      return JSON.parse(storedValue) as T;
    } catch (error) {
      console.error('Failed to read from AsyncStorage', error);
      return null;
    }
  };

  const set = async (value: T) => {
    try {
      const stringValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, stringValue);
    } catch (error) {
      console.error('Failed to write to AsyncStorage', error);
    }
  };

  const update = async (updates: Partial<T>) => {
    try {
      const currentValue = await get();
      const newValue = currentValue
        ? { ...currentValue, ...updates }
        : (updates as T);
      await set(newValue);
    } catch (error) {
      console.error('Failed to update AsyncStorage value', error);
    }
  };

  const remove = async () => {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to remove AsyncStorage value', error);
    }
  };

  return { get, set, update, remove };
}
