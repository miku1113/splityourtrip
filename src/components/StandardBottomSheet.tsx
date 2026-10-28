import React, { useRef, useEffect } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  StyleProp,
  ViewStyle,
  ScrollView,
  Animated,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useThemeStore';

export interface StandardBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number | string;
  sheetStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  showHandle?: boolean;
}

/**
 * A rock-solid, static bottom sheet modal without draggable pan-gesture glitches.
 * It is firmly anchored to the bottom of the screen with safe area padding,
 * and dismisses cleanly when tapping the semi-transparent backdrop,
 * swiping down on the top grab handle, or tapping close.
 */
export const StandardBottomSheet: React.FC<StandardBottomSheetProps> = ({
  visible,
  onClose,
  children,
  maxHeight = '90%',
  sheetStyle,
  contentStyle,
  scrollable = true,
  showHandle = true,
}) => {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const panY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      panY.setValue(0);
    }
  }, [visible]);

  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          panY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 70 || gestureState.vy > 0.6) {
          Animated.timing(panY, {
            toValue: 600,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            onClose();
            panY.setValue(0);
          });
        } else {
          Animated.spring(panY, {
            toValue: 0,
            bounciness: 4,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  // Flatten sheet style to extract any custom horizontal/top styling without clobbering safe bottom padding
  const flattenedSheetStyle = (StyleSheet.flatten(sheetStyle) || {}) as ViewStyle;
  const {
    padding,
    paddingHorizontal,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingVertical,
    paddingBottom,
    ...restSheetStyle
  } = flattenedSheetStyle;

  const horizontalPad = paddingHorizontal ?? padding ?? 20;
  const topPad = paddingTop ?? paddingVertical ?? 4;
  const customBottomExtra = paddingBottom != null ? Math.max(0, Number(paddingBottom) - 16) : 0;
  const safeBottomPadding = Math.max(insets.bottom, 16) + 16 + customBottomExtra;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlayContainer} pointerEvents="box-none">
        {/* Backdrop: tap anywhere outside the sheet to dismiss */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* Bottom anchored sheet card */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                maxHeight: maxHeight as any,
                paddingHorizontal: horizontalPad,
                paddingTop: topPad,
                transform: [{ translateY: panY }],
              },
              restSheetStyle,
            ]}
            pointerEvents="auto"
          >
            {/* Grab handle indicator pill */}
            {showHandle && (
              <View
                style={styles.handleContainer}
                hitSlop={{ top: 10, bottom: 10, left: 40, right: 40 }}
                {...handlePanResponder.panHandlers}
              >
                <View
                  style={[
                    styles.handlePill,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255, 255, 255, 0.28)'
                        : 'rgba(0, 0, 0, 0.22)',
                    },
                  ]}
                />
              </View>
            )}

            {scrollable ? (
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={[
                  styles.scrollContent,
                  contentStyle,
                  { paddingBottom: safeBottomPadding },
                ]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bounces={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View
                style={[
                  styles.contentArea,
                  contentStyle,
                  { paddingBottom: safeBottomPadding },
                ]}
              >
                {children}
              </View>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  keyboardContainer: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    width: '100%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 24,
    overflow: 'hidden',
  },
  handleContainer: {
    width: '100%',
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handlePill: {
    width: 40,
    height: 4.5,
    borderRadius: 3,
  },
  scrollArea: {
    width: '100%',
  },
  scrollContent: {
    width: '100%',
    flexGrow: 1,
  },
  contentArea: {
    width: '100%',
  },
});

export default StandardBottomSheet;
