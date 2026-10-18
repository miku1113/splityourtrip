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
}

export const DraggableBottomSheet: React.FC<DraggableBottomSheetProps> = ({
  visible,
  onClose,
  children,
  maxHeight = '85%',
  minHeight,
  height,
  sheetStyle,
  overlayStyle,
  showHandle = true,
  handleColor,
  keyboardAvoiding = true,
  dragThreshold = 80,
}) => {
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(visible);

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Track if dismissing animation is underway
  const isClosingRef = useRef(false);

  const animateIn = () => {
    isClosingRef.current = false;
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
        toValue: SCREEN_HEIGHT * 0.8,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
      isClosingRef.current = false;
      if (callback) callback();
      onClose();
    });
  };

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      // Give modal a frame to mount before sliding up
      requestAnimationFrame(() => {
        animateIn();
      });
    } else if (modalVisible) {
      animateOut();
    }
  }, [visible]);

  // PanResponder to handle drag gestures on the handle and top bar
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only claim gesture if there's clear vertical movement
        return Math.abs(gestureState.dy) > 4;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          // Downward drag tracks 1:1
          translateY.setValue(gestureState.dy);
        } else {
          // Upward drag has resistance
          translateY.setValue(gestureState.dy * 0.2);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > dragThreshold || gestureState.vy > 0.6) {
          // Dragged down past threshold or flicked down -> dismiss
          animateOut();
        } else {
          // Snap back to top
          Animated.spring(translateY, {
            toValue: 0,
            damping: 20,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        }
      },
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
        {/* Drag Handle Bar with generous hit zone */}
        {showHandle && (
          <View style={styles.handleHitZone} {...panResponder.panHandlers}>
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

        {children}
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
    overflow: 'hidden',
  },
  handleHitZone: {
    width: '100%',
    height: 28,
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
