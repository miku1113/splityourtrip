import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/useThemeStore';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export interface DraggableBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number | string;
  minHeight?: number | string;
  height?: number | string;
  sheetStyle?: StyleProp<ViewStyle>;
  overlayStyle?: StyleProp<ViewStyle>;
  showHandle?: boolean;
  handleColor?: string;
  keyboardAvoiding?: boolean;
  dragThreshold?: number;
  enableExpandUp?: boolean;
  dragEntireSheet?: boolean;
}

export const DraggableBottomSheet: React.FC<DraggableBottomSheetProps> = ({
  visible,
  onClose,
  children,
  maxHeight = '90%',
  minHeight,
  height,
  sheetStyle,
  overlayStyle,
  showHandle = true,
  handleColor,
  keyboardAvoiding = true,
  dragThreshold = 80,
  enableExpandUp = true,
  dragEntireSheet = false,
}) => {
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(visible);

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Track snap state: 0 = Default (Base content height), 1 = Expanded (pulled UP)
  const currentSnap = useRef<0 | 1>(0);

  // Maximum distance the user can pull the sheet UP
  const maxUpOffsetRef = useRef(180);
  const measuredHeightRef = useRef(0);

  // Track if dismissing animation is underway
  const isClosingRef = useRef(false);

  const animateIn = () => {
    isClosingRef.current = false;
    currentSnap.current = 0;
    translateY.setValue(SCREEN_HEIGHT * 0.7);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 24,
        mass: 0.8,
        stiffness: 280,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animateOut = (callback?: () => void) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT * 0.9,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
      isClosingRef.current = false;
      currentSnap.current = 0;
      translateY.setValue(0);
      if (callback) callback();
      onClose();
    });
  };

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      requestAnimationFrame(() => {
        animateIn();
      });
    } else if (modalVisible) {
      animateOut();
    }
  }, [visible]);

  // Shared move handler
  const handlePanMove = (_: any, gestureState: any) => {
    const baseOffset = currentSnap.current === 1 ? -maxUpOffsetRef.current : 0;
    const target = baseOffset + gestureState.dy;

    if (target < -maxUpOffsetRef.current) {
      // Past max expanded limit: apply gentle rubber-band resistance
      const over = -maxUpOffsetRef.current - target;
      translateY.setValue(-maxUpOffsetRef.current - over * 0.25);
    } else {
      // Smooth 1:1 tracking for both UP and DOWN movement
      translateY.setValue(target);
    }
  };

  // Shared release handler
  const handlePanRelease = (_: any, gestureState: any) => {
    const maxUp = maxUpOffsetRef.current;

    if (currentSnap.current === 0) {
      // Starting at DEFAULT (Base Height)
      if (enableExpandUp && maxUp > 30 && (gestureState.dy < -45 || gestureState.vy < -0.35)) {
        // Dragged or flicked UP -> Expand upward!
        currentSnap.current = 1;
        Animated.spring(translateY, {
          toValue: -maxUp,
          damping: 22,
          mass: 0.8,
          stiffness: 260,
          useNativeDriver: true,
        }).start();
      } else if (gestureState.dy > dragThreshold || gestureState.vy > 0.5) {
        // Dragged or flicked DOWN -> Dismiss!
        animateOut();
      } else {
        // Settle back to DEFAULT (Base Height)
        currentSnap.current = 0;
        Animated.spring(translateY, {
          toValue: 0,
          damping: 20,
          stiffness: 300,
          useNativeDriver: true,
        }).start();
      }
    } else {
      // Starting at EXPANDED (Pulled Up)
      if (gestureState.dy > maxUp + 60 || gestureState.vy > 1.1) {
        // Strong pull down from expanded -> Dismiss!
        animateOut();
      } else if (gestureState.dy > 45 || gestureState.vy > 0.35) {
        // Pull down -> Return to DEFAULT (Base Height)
        currentSnap.current = 0;
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 260,
          useNativeDriver: true,
        }).start();
      } else {
        // Settle back at EXPANDED
        currentSnap.current = 1;
        Animated.spring(translateY, {
          toValue: -maxUp,
          damping: 20,
          stiffness: 300,
          useNativeDriver: true,
        }).start();
      }
    }
  };

  // PanResponder 1: Handle pill bar (immediately captures on touch)
  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 2,
      onPanResponderMove: handlePanMove,
      onPanResponderRelease: handlePanRelease,
    })
  ).current;

  // PanResponder 2: Sheet body (only captures vertical drags, passes taps through to buttons)
  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
      },
      onPanResponderMove: handlePanMove,
      onPanResponderRelease: handlePanRelease,
    })
  ).current;

  if (!modalVisible) return null;

  const content = (
    <View style={[styles.overlayContainer, overlayStyle]}>
      {/* 1. Backdrop Touch Area: Clicking on the dark area outside closes the sheet */}
      <TouchableWithoutFeedback onPress={() => animateOut()}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: backdropOpacity.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.6],
              }),
            },
          ]}
        />
      </TouchableWithoutFeedback>

      {/* 2. Draggable Bottom Sheet */}
      <Animated.View
        {...(dragEntireSheet ? sheetPanResponder.panHandlers : {})}
        style={[
          styles.sheetContainer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            maxHeight: maxHeight as any,
            minHeight: minHeight as any,
            height: height as any,
            transform: [{ translateY }],
          },
          sheetStyle,
        ]}
      >
        {/* Bottom overdraw filler so when pulled UP, no gap appears underneath */}
        <View
          style={[
            styles.bottomFiller,
            {
              backgroundColor: colors.card,
            },
          ]}
          pointerEvents="none"
        />

        {/* Drag Handle Bar with generous hit zone that captures handlePanResponder */}
        {showHandle && (
          <View
            style={styles.handleHitZone}
            hitSlop={{ top: 16, bottom: 16, left: 40, right: 40 }}
            {...handlePanResponder.panHandlers}
          >
            <View
              style={[
                styles.handlePill,
                {
                  backgroundColor: handleColor || colors.border,
                },
              ]}
            />
          </View>
        )}

        {/* Content container with layout measurement for dynamic maxUp calculation */}
        <View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 60) {
              measuredHeightRef.current = h;
              // Space available between top of content and screen ceiling (leaving 80px top margin)
              const availableUp = Math.max(0, SCREEN_HEIGHT - h - 100);
              maxUpOffsetRef.current = Math.min(availableUp, SCREEN_HEIGHT * 0.5);
            }
          }}
        >
          {children}
        </View>
      </Animated.View>
    </View>
  );

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={() => animateOut()}
      statusBarTranslucent
    >
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  overlayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 20,
  },
  bottomFiller: {
    position: 'absolute',
    bottom: -800,
    left: 0,
    right: 0,
    height: 800,
  },
  handleHitZone: {
    width: '100%',
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  handlePill: {
    width: 44,
    height: 5,
    borderRadius: 3,
    opacity: 0.8,
  },
});
