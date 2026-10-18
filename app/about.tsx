import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Linking,
  Share,
  Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/useThemeStore';

export default function AboutUsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const handleShareApp = async () => {
    try {
      await Share.share({
        title: 'Split Your Trip by MJ Studios',
        message:
          'Split Your Trip makes traveling with friends stress-free! Split expenses, scan receipts, and settle balances effortlessly. Download now: https://splityourtrip.app',
      });
    } catch {}
  };

  const handleContactEmail = () => {
    Linking.openURL('mailto:splityourtrip1@gmail.com?subject=Split%20Your%20Trip%20Feedback');
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(insets.bottom, 24) + 40 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen
        options={{
          title: 'About Us',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />

      {/* Hero Branding Header */}
      <View
        style={[
          styles.heroCard,
          {
            backgroundColor: isDark ? '#1C2432' : '#F0F4FF',
            borderColor: isDark ? 'rgba(120, 149, 183, 0.25)' : '#DCE5F8',
          },
        ]}
      >
        <View style={[styles.logoContainer, { backgroundColor: colors.card }]}>
          <Image
            source={require('../assets/images/split-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        <Text style={[styles.appName, { color: colors.text }]}>Split Your Trip</Text>
        <Text style={[styles.appTagline, { color: colors.textSecondary }]}>
          Travel Together • Split Effortlessly
        </Text>

        {/* Made by MJ Studios Banner */}
        <View style={[styles.studioBadge, { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF', borderColor: colors.primary }]}>
          <Ionicons name="sparkles" size={14} color={colors.primary} />
          <Text style={[styles.studioBadgeText, { color: colors.primary }]}>
            Made with ❤️ by <Text style={{ fontWeight: '800' }}>MJ Studios</Text>
          </Text>
        </View>

        <View style={styles.versionRow}>
          <View style={[styles.versionPill, { backgroundColor: isDark ? '#263143' : '#E2E8F0' }]}>
            <Text style={[styles.versionText, { color: colors.textSecondary }]}>
              Version 1.0.36 (Build 37)
            </Text>
          </View>
          <View style={[styles.versionPill, { backgroundColor: isDark ? '#263143' : '#E2E8F0' }]}>
            <Text style={[styles.versionText, { color: colors.textSecondary }]}>
              Production Release
            </Text>
          </View>
        </View>
      </View>

      {/* Mission & Story Card */}
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionIconBox, { backgroundColor: '#EEF2FF' }]}>
            <Ionicons name="rocket-outline" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Our Mission</Text>
            <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
              Why MJ Studios built this app
            </Text>
          </View>
        </View>

        <Text style={[styles.paragraphText, { color: colors.text }]}>
          Traveling with friends, family, or colleagues should be about making lifelong memories, not awkward conversations about who owes what.
        </Text>
        <Text style={[styles.paragraphText, { color: colors.textSecondary, marginTop: 8 }]}>
          At <Text style={{ color: colors.primary, fontWeight: '700' }}>MJ Studios</Text>, our goal was to craft a zero-friction, lightning-fast travel expense companion that works everywhere — even in remote destinations with zero cellular network. We designed Split Your Trip from the ground up to be offline-first, mathematically precise, and privacy-respecting.
        </Text>
      </View>

      {/* What Makes Us Different */}
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionIconBox, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color="#10B981" />
          </View>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Key Superpowers</Text>
            <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
              Engineered for real travelers
            </Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={[styles.featureIcon, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="flash" size={16} color="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.featureTitle, { color: colors.text }]}>Offline-First Engine</Text>
            <Text style={[styles.featureDesc, { color: colors.textSecondary }]}>
              Add expenses, view balances, and track trips completely offline. Syncs seamlessly the moment you re-connect.
            </Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={[styles.featureIcon, { backgroundColor: '#E0E7FF' }]}>
            <Ionicons name="git-network-outline" size={16} color="#4F46E5" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.featureTitle, { color: colors.text }]}>Smart Debt Simplification</Text>
            <Text style={[styles.featureDesc, { color: colors.textSecondary }]}>
              Our algorithm minimizes cash transactions across the whole group, so 50 transactions resolve in just 3 simple payments.
            </Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={[styles.featureIcon, { backgroundColor: '#FEE2E2' }]}>
            <Ionicons name="scan-outline" size={16} color="#DC2626" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.featureTitle, { color: colors.text }]}>Receipt AI Scanning</Text>
            <Text style={[styles.featureDesc, { color: colors.textSecondary }]}>
              Snap a restaurant or fuel receipt. OCR extracts totals, merchants, and items in seconds.
            </Text>
          </View>
        </View>

        <View style={styles.featureItem}>
          <View style={[styles.featureIcon, { backgroundColor: '#F3E8FF' }]}>
            <Ionicons name="pie-chart-outline" size={16} color="#9333EA" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.featureTitle, { color: colors.text }]}>Realtime Spending Analyser</Text>
            <Text style={[styles.featureDesc, { color: colors.textSecondary }]}>
              Visual category breakdowns, daily trends, velocity charts, and instant report exports.
            </Text>
          </View>
        </View>
      </View>

      {/* Quick Action Navigation Buttons */}
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.linksSectionHeading, { color: colors.textMuted }]}>
          LEGAL & SUPPORT
        </Text>

        <TouchableOpacity
          style={[styles.linkRow, { borderBottomColor: colors.borderLight }]}
          onPress={() => router.push('/privacy')}
          activeOpacity={0.7}
        >
          <View style={[styles.linkIconBox, { backgroundColor: '#EEF2FF' }]}>
            <Ionicons name="document-text-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.linkTitle, { color: colors.text }]}>Privacy Policy</Text>
            <Text style={[styles.linkSubtitle, { color: colors.textSecondary }]}>
              Our pledge: Zero data selling, encrypted security
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.linkRow, { borderBottomColor: colors.borderLight }]}
          onPress={handleContactEmail}
          activeOpacity={0.7}
        >
          <View style={[styles.linkIconBox, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="mail-outline" size={18} color="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.linkTitle, { color: colors.text }]}>Contact MJ Studios</Text>
            <Text style={[styles.linkSubtitle, { color: colors.textSecondary }]}>
              splityourtrip1@gmail.com
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.linkRow, { borderBottomColor: 'transparent' }]}
          onPress={handleShareApp}
          activeOpacity={0.7}
        >
          <View style={[styles.linkIconBox, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="share-social-outline" size={18} color="#10B981" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.linkTitle, { color: colors.text }]}>Share App with Friends</Text>
            <Text style={[styles.linkSubtitle, { color: colors.textSecondary }]}>
              Invite travel buddies to download
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Developer & Copyright Footer */}
      <View style={styles.footerWrap}>
        <Text style={[styles.footerTextPrimary, { color: colors.textSecondary }]}>
          Designed, Developed & Maintained by
        </Text>
        <Text style={[styles.footerStudioName, { color: colors.text }]}>
          MJ STUDIOS
        </Text>
        <Text style={[styles.footerCopyright, { color: colors.textMuted }]}>
          © 2026 MJ Studios. All Rights Reserved.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  appName: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  appTagline: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 14,
  },
  studioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 14,
  },
  studioBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  versionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  versionPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  versionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sectionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSub: {
    fontSize: 12,
    marginTop: 2,
  },
  paragraphText: {
    fontSize: 14,
    lineHeight: 21,
  },
  featureItem: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  featureDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
  linksSectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  linkIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  linkSubtitle: {
    fontSize: 12,
  },
  footerWrap: {
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 12,
  },
  footerTextPrimary: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  footerStudioName: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  footerCopyright: {
    fontSize: 11,
  },
});
