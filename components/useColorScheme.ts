import { useColorScheme as useColorSchemeCore } from 'react-native';

export const useColorScheme = (): 'dark' | 'light' => {
  const coreScheme = useColorSchemeCore();
  return coreScheme === 'light' ? 'light' : 'dark';
};
