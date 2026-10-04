import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
  Alert,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useThemeStore';
import { useAuthStore } from '../features/auth/useAuthStore';
import { useContactsStore } from '../features/contacts/useContactsStore';
import { getCurrencyInfo } from '../services/currency';

interface SidebarDrawerProps {
  visible: boolean;
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 340);

export default function SidebarDrawer({ visible, onClose }: SidebarDrawerProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { user, profile, signOut } = useAuthStore();
  const { inviteFriend } = useContactsStore();
  const insets = useSafeAreaInsets();

  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const closeRotate = useRef(new Animated.Value(0)).current;
  const [avatarError, setAvatarError] = React.useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [profile?.avatar_url]);

  useEffect(() => {
    if (visible) {
      // Reset slide to start position before animating in
      slideAnim.setValue(DRAWER_WIDTH);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(closeRotate, {
          toValue: 1,
          duration: 350,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: DRAWER_WIDTH,
          duration: 250,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(closeRotate, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const closeIconRotation = closeRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  const handleNavigate = (path: any) => {
    onClose();
    setTimeout(() => {
      router.push(path);
    }, 150);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          onClose();
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const displayName = profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'Traveler';
  const email = user?.email || 'Offline Session';
  const phone = profile?.phone_number;
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const currencyInfo = getCurrencyInfo(profile?.currency || 'INR');

  // Safe top padding: status bar + a little breathing room
  const headerPaddingTop = insets.top + 12;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Dim backdrop — tap to close */}
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
          />
        </Animated.View>

        {/* Sliding Drawer */}
        <Animated.View
          style={[
            styles.drawerContainer,
            {
              width: DRAWER_WIDTH,
              backgroundColor: colors.card,
              borderLeftColor: colors.border,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          {/* ── Close (X) button — top-right corner of the drawer ── */}
          <Animated.View
            style={[
              styles.closeBtn,
              {
                top: headerPaddingTop + 4,
                transform: [{ rotate: closeIconRotation }],
              },
            ]}
          >
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              style={[
                styles.closeBtnInner,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
              ]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </Animated.View>

          {/* ── Profile Header ── */}
          <View
            style={[
              styles.headerCard,
              {
                paddingTop: headerPaddingTop + 48,  // room for close button above
                backgroundColor: isDark ? 'rgba(99, 102, 241, 0.12)' : '#EEF2FF',
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: colors.primary, overflow: 'hidden' }]}>
              {profile?.avatar_url && !avatarError ? (
                <Image
                  source={{ uri: profile.avatar_url }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <Text style={styles.avatarText}>{avatarLetter}</Text>
              )}
            </View>

            <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]} numberOfLines={1}>
              {email}
            </Text>
            {phone && (
              <View style={styles.phoneBadge}>
                <Ionicons name="call-outline" size={12} color={colors.primary} />
                <Text style={[styles.profilePhone, { color: colors.primary }]}>{phone}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.viewProfileBtn, { backgroundColor: colors.primary }]}
              onPress={() => handleNavigate('/(tabs)/profile')}
            >
              <Ionicons name="person-outline" size={14} color="#FFFFFF" />
              <Text style={styles.viewProfileText}>View Full Profile</Text>
            </TouchableOpacity>
          </View>

          {/* ── Menu Items ── */}
          <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionHeaderText, { color: colors.textMuted }]}>
                NAVIGATION
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.menuItemRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => handleNavigate('/settings')}
            >
              <View style={[styles.menuIconBox, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="settings" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemTitle, { color: colors.text }]}>Settings</Text>
                <Text style={[styles.menuItemSubtitle, { color: colors.textSecondary }]}>
                  Currency ({currencyInfo.code} {currencyInfo.symbol}), alerts
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItemRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => handleNavigate('/(tabs)/analyser')}
            >
              <View style={[styles.menuIconBox, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="pie-chart" size={18} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemTitle, { color: colors.text }]}>Spending Analyser</Text>
                <Text style={[styles.menuItemSubtitle, { color: colors.textSecondary }]}>
                  Charts, categories & trends
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItemRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => handleNavigate('/(tabs)')}
            >
              <View style={[styles.menuIconBox, { backgroundColor: '#E0E7FF' }]}>
                <Ionicons name="airplane" size={18} color="#4F46E5" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemTitle, { color: colors.text }]}>My Trips</Text>
                <Text style={[styles.menuItemSubtitle, { color: colors.textSecondary }]}>
                  Manage active & completed trips
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItemRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => handleNavigate('/(tabs)/friends')}
            >
              <View style={[styles.menuIconBox, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="people" size={18} color="#16A34A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemTitle, { color: colors.text }]}>Friends & Balances</Text>
                <Text style={[styles.menuItemSubtitle, { color: colors.textSecondary }]}>
                  Who owes who, contact book
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionHeaderText, { color: colors.textMuted }]}>
                TOOLS & MORE
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.menuItemRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => { onClose(); inviteFriend('Friend'); }}
            >
              <View style={[styles.menuIconBox, { backgroundColor: '#FEE2E2' }]}>
                <Ionicons name="share-social" size={18} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemTitle, { color: colors.text }]}>Invite Friends</Text>
                <Text style={[styles.menuItemSubtitle, { color: colors.textSecondary }]}>
                  Share Split Your Trip link
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItemRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => Alert.alert('Split Your Trip Support', 'Reach out to support@splityourtrip.app. We are here 24/7!')}
            >
              <View style={[styles.menuIconBox, { backgroundColor: '#F3E8FF' }]}>
                <Ionicons name="help-circle" size={18} color="#9333EA" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemTitle, { color: colors.text }]}>Help & Support</Text>
                <Text style={[styles.menuItemSubtitle, { color: colors.textSecondary }]}>
                  FAQs, offline tips & guides
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItemRow, { borderBottomColor: 'transparent', marginTop: 12 }]}
              onPress={handleSignOut}
            >
              <View style={[styles.menuIconBox, { backgroundColor: colors.dangerBg }]}>
                <Ionicons name="log-out" size={18} color={colors.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemTitle, { color: colors.danger }]}>Sign Out</Text>
                <Text style={[styles.menuItemSubtitle, { color: colors.textSecondary }]}>
                  Log out of this device
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>

          {/* ── Footer ── */}
          <View
            style={[
              styles.drawerFooter,
              {
                borderTopColor: colors.borderLight,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <Text style={[styles.footerAppName, { color: colors.text }]}>Split Your Trip</Text>
            <Text style={[styles.footerVersion, { color: colors.textMuted }]}>
              v1.2.0 • Offline First & Realtime
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  drawerContainer: {
    height: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 20,
  },
  // X button — absolutely positioned inside drawer, top-right corner
  closeBtn: {
    position: 'absolute',
    right: 14,
    zIndex: 10,
  },
  closeBtnInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCard: {
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: 13,
    marginBottom: 6,
  },
  phoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  profilePhone: {
    fontSize: 12,
    fontWeight: '600',
  },
  viewProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  viewProfileText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  menuScroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  menuItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuItemSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  drawerFooter: {
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  footerAppName: {
    fontSize: 13,
    fontWeight: '700',
  },
  footerVersion: {
    fontSize: 11,
    marginTop: 2,
  },
});
