import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
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

export interface DraggableBottomSheetContextType {
  isExpanded: boolean;
  snapIndex: 0 | 1;
  snapOffset: number;
  maxHeight: number;
  defaultHeight: number;
  expand: () => void;
  collapse: () => void;
  close: () => void;
  panHandlers: any;
}

export const DraggableBottomSheetContext = createContext<DraggableBottomSheetContextType>({
  isExpanded: false,
  snapIndex: 0,
  snapOffset: 0,
  maxHeight: 0,
  defaultHeight: 0,
  expand: () => {},
  collapse: () => {},
  close: () => {},
  panHandlers: {},
});

export const useDraggableBottomSheet = () => useContext(DraggableBottomSheetContext);

export interface DraggableBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children:
    | React.ReactNode
    | ((props: { isExpanded: boolean; snapIndex: 0 | 1; snapOffset: number }) => React.ReactNode);
  maxHeight?: number | string;
  minHeight?: number | string;
  defaultHeight?: number | string;
  initialHeight?: number | string;
  height?: number | string;
  sheetStyle?: StyleProp<ViewStyle>;
  overlayStyle?: StyleProp<ViewStyle>;
  showHandle?: boolean;
  handleColor?: string;
  keyboardAvoiding?: boolean;
  dragThreshold?: number;
  enableExpandUp?: boolean;
  dragEntireSheet?: boolean;
  initialExpanded?: boolean;
  onSnapChange?: (snap: 'default' | 'expanded') => void;
}

const resolveDimension = (val: number | string | undefined, defaultVal: number): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.endsWith('%')) {
    const pct = parseFloat(val) / 100;
    return isNaN(pct) ? defaultVal : SCREEN_HEIGHT * pct;
  }
  return defaultVal;
};

export const DraggableBottomSheet: React.FC<DraggableBottomSheetProps> = ({
  visible,
  onClose,
  children,
  maxHeight = '90%',
  minHeight,
  defaultHeight,
  initialHeight,
  height,
  sheetStyle,
  overlayStyle,
  showHandle = true,
  handleColor,
  keyboardAvoiding = true,
  dragThreshold = 80,
  enableExpandUp = true,
  dragEntireSheet = false,
  initialExpanded = false,
  onSnapChange,
}) => {
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(visible);
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  // Check if snap points architecture is enabled (when defaultHeight or initialHeight is specified)
  const hasSnapPoints = Boolean(defaultHeight || initialHeight);
  const resolvedMaxHeight = resolveDimension(maxHeight, SCREEN_HEIGHT * 0.90);
  const resolvedDefaultHeight = resolveDimension(defaultHeight || initialHeight, SCREEN_HEIGHT * 0.56);
  const snapOffset = hasSnapPoints ? Math.max(0, resolvedMaxHeight - resolvedDefaultHeight) : 0;

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Track snap state: 0 = Default, 1 = Expanded
  const currentSnap = useRef<0 | 1>(initialExpanded ? 1 : 0);

  // Maximum distance the user can pull the sheet UP for legacy auto-content mode
  const maxUpOffsetRef = useRef(180);
  const measuredHeightRef = useRef(0);

  // Track if dismissing animation is underway
  const isClosingRef = useRef(false);

  const expand = () => {
    if (isClosingRef.current) return;
    currentSnap.current = 1;
    setIsExpanded(true);
    onSnapChange?.('expanded');
    Animated.spring(translateY, {
      toValue: 0,
      damping: 22,
      mass: 0.8,
      stiffness: 260,
      useNativeDriver: true,
    }).start();
  };

  const collapse = () => {
    if (isClosingRef.current) return;
    currentSnap.current = 0;
    setIsExpanded(false);
    onSnapChange?.('default');
    const targetY = hasSnapPoints ? snapOffset : 0;
    Animated.spring(translateY, {
      toValue: targetY,
      damping: 22,
      mass: 0.8,
      stiffness: 260,
      useNativeDriver: true,
    }).start();
  };

  const animateIn = () => {
    isClosingRef.current = false;
    const shouldStartExpanded = Boolean(initialExpanded);
    currentSnap.current = shouldStartExpanded ? 1 : 0;
    setIsExpanded(shouldStartExpanded);
    onSnapChange?.(shouldStartExpanded ? 'expanded' : 'default');

    const targetY = hasSnapPoints ? (shouldStartExpanded ? 0 : snapOffset) : 0;
    translateY.setValue(SCREEN_HEIGHT);

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: targetY,
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
        toValue: SCREEN_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
      isClosingRef.current = false;
      currentSnap.current = 0;
      setIsExpanded(false);
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
  }, [visible, initialExpanded]);

  // Shared move handler
  const handlePanMove = (_: any, gestureState: any) => {
    if (hasSnapPoints) {
      const baseOffset = currentSnap.current === 1 ? 0 : snapOffset;
      const target = baseOffset + gestureState.dy;

      if (target < 0) {
        // Past expanded ceiling: gentle rubber-band resistance
        translateY.setValue(target * 0.25);
      } else {
        // Smooth 1:1 tracking
        translateY.setValue(target);
      }
    } else {
      // Legacy auto-content behavior
      const baseOffset = currentSnap.current === 1 ? -maxUpOffsetRef.current : 0;
      const target = baseOffset + gestureState.dy;

      if (target < -maxUpOffsetRef.current) {
        const over = -maxUpOffsetRef.current - target;
        translateY.setValue(-maxUpOffsetRef.current - over * 0.25);
      } else {
        translateY.setValue(target);
      }
    }
  };

  // Shared release handler
  const handlePanRelease = (_: any, gestureState: any) => {
    if (hasSnapPoints) {
      if (currentSnap.current === 0) {
        // Starting at DEFAULT snap (snapOffset)
        if (enableExpandUp && (gestureState.dy < -35 || gestureState.vy < -0.3)) {
          // Dragged or flicked UP -> Expand!
          expand();
        } else if (gestureState.dy > dragThreshold || gestureState.vy > 0.5) {
          // Dragged or flicked DOWN -> Dismiss!
          animateOut();
        } else {
          // Settle back to DEFAULT
          collapse();
        }
      } else {
        // Starting at EXPANDED snap (0)
        if (gestureState.dy > snapOffset + 80 || gestureState.vy > 1.2) {
          // Strong swipe down from top -> Dismiss directly!
          animateOut();
        } else if (gestureState.dy > 40 || gestureState.vy > 0.35) {
          // Dragged DOWN -> Snap to DEFAULT
          collapse();
        } else {
          // Settle back at EXPANDED
          expand();
        }
      }
    } else {
      // Legacy auto-content behavior
      const maxUp = maxUpOffsetRef.current;
      if (currentSnap.current === 0) {
        if (enableExpandUp && maxUp > 30 && (gestureState.dy < -45 || gestureState.vy < -0.35)) {
          currentSnap.current = 1;
          setIsExpanded(true);
          Animated.spring(translateY, {
            toValue: -maxUp,
            damping: 22,
            mass: 0.8,
            stiffness: 260,
            useNativeDriver: true,
          }).start();
        } else if (gestureState.dy > dragThreshold || gestureState.vy > 0.5) {
          animateOut();
        } else {
          currentSnap.current = 0;
          setIsExpanded(false);
          Animated.spring(translateY, {
            toValue: 0,
            damping: 20,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        }
      } else {
        if (gestureState.dy > maxUp + 60 || gestureState.vy > 1.1) {
          animateOut();
        } else if (gestureState.dy > 45 || gestureState.vy > 0.35) {
          currentSnap.current = 0;
          setIsExpanded(false);
          Animated.spring(translateY, {
            toValue: 0,
            damping: 22,
            mass: 0.8,
            stiffness: 260,
            useNativeDriver: true,
          }).start();
        } else {
          currentSnap.current = 1;
          setIsExpanded(true);
          Animated.spring(translateY, {
            toValue: -maxUp,
            damping: 20,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        }
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

  const sheetH = hasSnapPoints ? resolvedMaxHeight : height;
  const sheetMaxH = hasSnapPoints ? resolvedMaxHeight : maxHeight;

  const contextValue: DraggableBottomSheetContextType = {
    isExpanded,
    snapIndex: currentSnap.current,
    snapOffset,
    maxHeight: resolvedMaxHeight,
    defaultHeight: resolvedDefaultHeight,
    expand,
    collapse,
    close: animateOut,
    panHandlers: handlePanResponder.panHandlers,
  };

  const content = (
    <DraggableBottomSheetContext.Provider value={contextValue}>
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
              height: sheetH as any,
              maxHeight: sheetMaxH as any,
              minHeight: minHeight as any,
              transform: [{ translateY }],
            },
            sheetStyle,
          ]}
        >
          {/* Bottom overdraw filler ONLY needed when NOT hasSnapPoints */}
          {!hasSnapPoints && (
            <View
              style={[
                styles.bottomFiller,
                {
                  backgroundColor: colors.card,
                },
              ]}
              pointerEvents="none"
            />
          )}

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

          {/* Content container */}
          <View
            style={[styles.contentWrap, hasSnapPoints && { flex: 1 }]}
            onLayout={(e) => {
              if (!hasSnapPoints) {
                const h = e.nativeEvent.layout.height;
                if (h > 60) {
                  measuredHeightRef.current = h;
                  const availableUp = Math.max(0, SCREEN_HEIGHT - h - 100);
                  maxUpOffsetRef.current = Math.min(availableUp, SCREEN_HEIGHT * 0.5);
                }
              }
            }}
          >
            {typeof children === 'function'
              ? (children as any)({ isExpanded, snapIndex: currentSnap.current, snapOffset })
              : children}
          </View>
        </Animated.View>
      </View>
    </DraggableBottomSheetContext.Provider>
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
    overflow: 'hidden',
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
  contentWrap: {
    width: '100%',
  },
});
