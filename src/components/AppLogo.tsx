import React from 'react';
import { View, Image, StyleSheet, ViewStyle, ImageStyle } from 'react-native';

interface AppLogoProps {
  size?: number;
  showGlow?: boolean;
  style?: ViewStyle;
  imageStyle?: ImageStyle;
}

export const AppLogo: React.FC<AppLogoProps> = ({
  size = 64,
  showGlow = false,
  style,
  imageStyle,
}) => {
  return (
    <View style={[styles.container, style]}>
      {showGlow && (
        <View
          style={[
            styles.glowRing,
            {
              width: size * 1.35,
              height: size * 1.35,
              borderRadius: (size * 1.35) / 2,
            },
          ]}
        />
      )}
      <Image
        source={require('../../assets/images/split-logo.png')}
        style={[
          {
            width: size,
            height: size,
          },
          imageStyle,
        ]}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  glowRing: {
    position: 'absolute',
    backgroundColor: 'rgba(120, 149, 183, 0.25)',
    shadowColor: '#7895B7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 8,
  },
});

export default AppLogo;
