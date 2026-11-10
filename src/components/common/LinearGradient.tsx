import React from 'react';
import { View, ViewProps, UIManager, Platform } from 'react-native';

export type LinearGradientPoint = {
  x: number;
  y: number;
};

export type LinearGradientProps = ViewProps & {
  colors: readonly string[];
  locations?: readonly number[] | null;
  start?: LinearGradientPoint | null;
  end?: LinearGradientPoint | null;
  dither?: boolean;
  children?: React.ReactNode;
};

// Safely test if the native ViewManager is present in UIManager before calling expo-linear-gradient
const isNativeAvailable = (): boolean => {
  if (Platform.OS === 'web') return true;
  try {
    if (!UIManager || typeof UIManager.getViewManagerConfig !== 'function') {
      return false;
    }
    return Boolean(
      UIManager.getViewManagerConfig('ViewManagerAdapter_ExpoLinearGradient') ||
      UIManager.getViewManagerConfig('ExpoLinearGradient')
    );
  } catch {
    return false;
  }
};

let ExpoLinearGradientComponent: any = null;

try {
  if (isNativeAvailable()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ExpoLinearGradientComponent = require('expo-linear-gradient').LinearGradient;
  }
} catch {
  ExpoLinearGradientComponent = null;
}

/**
 * Robust LinearGradient component that falls back gracefully to a solid background
 * if the native ExpoLinearGradient view manager was not linked into the running binary.
 */
export const LinearGradient: React.FC<LinearGradientProps> = ({
  colors,
  locations,
  start,
  end,
  dither,
  style,
  children,
  ...rest
}) => {
  if (ExpoLinearGradientComponent) {
    return (
      <ExpoLinearGradientComponent
        colors={colors}
        locations={locations}
        start={start}
        end={end}
        dither={dither}
        style={style}
        {...rest}
      >
        {children}
      </ExpoLinearGradientComponent>
    );
  }

  // Graceful fallback: render a View with the primary gradient color
  const fallbackBg = colors && colors.length > 0 ? colors[0] : 'transparent';
  return (
    <View style={[{ backgroundColor: fallbackBg }, style]} {...rest}>
      {children}
    </View>
  );
};

export default LinearGradient;
