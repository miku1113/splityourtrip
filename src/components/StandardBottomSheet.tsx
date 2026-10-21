import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  StyleProp,
  ViewStyle,
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
  showHandle?: boolean;
}

/**
 * A rock-solid, static bottom sheet modal without draggable pan-gesture glitches.
 * It is firmly anchored to the bottom of the screen with safe area padding,
 * and dismisses cleanly when tapping the semi-transparent backdrop.
 */
export const StandardBottomSheet: React.FC<StandardBottomSheetProps> = ({
  visible,
  onClose,
  children,
  maxHeight = '90%',
  sheetStyle,
  contentStyle,
  showHandle = false,
}) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlayContainer}>
        {/* Backdrop: tap anywhere outside the sheet to dismiss */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* Bottom anchored sheet card */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
        >
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                maxHeight: maxHeight as any,
                paddingBottom: Math.max(insets.bottom, 16),
              },
              sheetStyle,
            ]}
          >
            {/* Optional subtle pill handle */}
            {showHandle && (
              <View style={styles.handleContainer}>
                <View style={[styles.handlePill, { backgroundColor: colors.border }]} />
              </View>
            )}

            <View style={[styles.contentArea, contentStyle]}>
              {children}
            </View>
          </View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  keyboardContainer: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 20,
  },
  handleContainer: {
    width: '100%',
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
  },
  handlePill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.7,
  },
  contentArea: {
    width: '100%',
  },
});

export default StandardBottomSheet;
