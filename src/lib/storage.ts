import AsyncStorage from '@react-native-async-storage/async-storage';

const memoryStore: Record<string, string> = {};

export const AppStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const val = await AsyncStorage.getItem(key);
      if (val !== null && val !== undefined) {
        memoryStore[key] = val;
        return val;
      }
      return memoryStore[key] || null;
    } catch (e) {
      return memoryStore[key] || null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    memoryStore[key] = value;
    try {
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      // Memory fallback remains active
    }
  },

  removeItem: async (key: string): Promise<void> => {
    delete memoryStore[key];
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
      // Memory fallback remains active
    }
  },
};
