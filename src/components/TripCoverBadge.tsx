import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, ImageStyle, TextStyle } from 'react-native';
import { useTheme } from '../theme/useThemeStore';
import { scaleFont, moderateScale } from '../theme/responsive';

interface TripCoverBadgeProps {
  imageUrl?: string | null;
  size?: number;
  fallbackEmoji?: string;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  textStyle?: StyleProp<TextStyle>;
  borderRadius?: number;
}

export const TripCoverBadge: React.FC<TripCoverBadgeProps> = ({
  imageUrl,
  size = 44,
  fallbackEmoji = '🌴',
  style,
  imageStyle,
  textStyle,
  borderRadius = 12,
}) => {
  const { colors, isDark } = useTheme();
  const [hasError, setHasError] = useState(false);

  // If emoji string: "emoji:🏖️"
  if (imageUrl && imageUrl.startsWith('emoji:')) {
    const emojiChar = imageUrl.replace('emoji:', '') || fallbackEmoji;
    return (
      <View
        style={[
          styles.container,
          {
            width: moderateScale(size),
            height: moderateScale(size),
            borderRadius,
            backgroundColor: isDark ? 'rgba(99, 102, 241, 0.18)' : '#EEF2FF',
          },
          style,
        ]}
      >
        <Text style={[styles.emojiText, { fontSize: scaleFont(size * 0.5) }, textStyle]}>
          {emojiChar}
        </Text>
      </View>
    );
  }

  // If valid image url and no load error
  const isValidUri = Boolean(imageUrl && !hasError && (imageUrl.startsWith('http') || imageUrl.startsWith('file:') || imageUrl.startsWith('data:')));

  if (isValidUri && imageUrl) {
    return (
      <View
        style={[
          styles.container,
          {
            width: moderateScale(size),
            height: moderateScale(size),
            borderRadius,
            backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#E0E7FF',
            overflow: 'hidden',
          },
          style,
        ]}
      >
        <Image
          source={{ uri: imageUrl }}
          style={[
            styles.image,
            { width: '100%', height: '100%' },
            imageStyle,
          ]}
          resizeMode="cover"
          onError={() => setHasError(true)}
        />
      </View>
    );
  }

  // Fallback to default emoji
  return (
    <View
      style={[
        styles.container,
        {
          width: moderateScale(size),
          height: moderateScale(size),
          borderRadius,
          backgroundColor: isDark ? 'rgba(99, 102, 241, 0.18)' : '#EEF2FF',
        },
        style,
      ]}
    >
      <Text style={[styles.emojiText, { fontSize: scaleFont(size * 0.5) }, textStyle]}>
        {fallbackEmoji}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  emojiText: {
    textAlign: 'center',
  },
});

export default TripCoverBadge;
