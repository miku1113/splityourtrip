import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/useThemeStore';

interface PolicySection {
  id: string;
  title: string;
  icon: any;
  iconBg: string;
  iconColor: string;
  content: string[];
}

const POLICY_SECTIONS: PolicySection[] = [
  {
    id: 'collect',
    title: '1. Information We Collect',
    icon: 'folder-open-outline',
    iconBg: '#EEF2FF',
    iconColor: '#6366F1',
    content: [
      'Account & Auth: When you sign in via email or Google Sign-In, we store your name, email, and optional avatar URL to authenticate your account securely.',
      'Trips & Expenses: We store your trip titles, dates, expense descriptions, amounts, categories, currency choices, and member split allocations.',
      'Settlement Details: Optional UPI IDs and payment confirmation notes used by group members to settle debts directly.',
      'Receipt Images (Optional): Bill photos you choose to capture or upload with an expense for record keeping.',
      'Device Permissions (Optional): Camera & Media (to scan receipts or upload trip cover photos), Contacts (READ_CONTACTS, strictly optional to select friends locally — your contact book is NEVER uploaded or sold to anyone).',
    ],
  },
  {
    id: 'use',
    title: '2. How We Use Information',
    icon: 'construct-outline',
    iconBg: '#FEF3C7',
    iconColor: '#D97706',
    content: [
      'To calculate balances, individual shares, and minimum transaction settlements across trip participants accurately.',
      'To synchronize real-time updates and notifications whenever expenses are added, edited, or settled.',
      'To authenticate user access and verify group permissions using Row-Level Security.',
      'To deliver push alerts for new expenses, debt settlements, and in-trip group discussions.',
    ],
  },
  {
    id: 'sharing',
    title: '3. Data Sharing & Third Parties',
    icon: 'share-social-outline',
    iconBg: '#ECFDF5',
    iconColor: '#10B981',
    content: [
      'Trip Members Only: Your expenses and uploaded receipts are shared strictly with the authorized participants of that specific trip.',
      'No Data Brokers: MJ Studios does not sell, rent, monetize, or broker your personal information or financial data to any advertisers or third-party brokers.',
      'Infrastructure Partners: We rely on trusted enterprise infrastructure (Supabase for encrypted database storage & Google Identity for secure OAuth). All data transmissions use HTTPS/TLS 1.3 encryption.',
    ],
  },
  {
    id: 'security',
    title: '4. Security & Offline Storage',
    icon: 'lock-closed-outline',
    iconBg: '#FEE2E2',
    iconColor: '#EF4444',
    content: [
      'All offline data stored on your device is protected by operating system sandboxing.',
      'All cloud communications are strictly encrypted over TLS/HTTPS.',
      'Database access is protected by Supabase Row-Level Security (RLS) policies, guaranteeing only trip members can read or edit their trip data.',
    ],
  },
  {
    id: 'deletion',
    title: '5. Data Retention & Account Deletion',
    icon: 'trash-outline',
    iconBg: '#F3E8FF',
    iconColor: '#9333EA',
    content: [
      'You have complete sovereignty over your data.',
      'You can edit or delete any expense or trip you created directly within the application at any time.',
      'You can request complete deletion of your account and all associated personal data by emailing splityourtrip1@gmail.com.',
      'All account deletion requests are fully processed within 30 days in strict accordance with Google Play Developer Policy.',
    ],
  },
  {
    id: 'children',
    title: '6. Children\'s Privacy',
    icon: 'people-outline',
    iconBg: '#EFF6FF',
    iconColor: '#3B82F6',
    content: [
      'Split Your Trip is not directed toward children under 13 years of age.',
      'We do not knowingly collect personal information from individuals under 13. If discovered, such records are permanently purged.',
    ],
  },
];

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    collect: true,
    use: true,
    sharing: true,
    security: false,
    deletion: true,
    children: false,
  });

  const toggleSection = (id: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleEmailSupport = () => {
    Linking.openURL('mailto:splityourtrip1@gmail.com?subject=Privacy%20Policy%20Inquiry%20-%20Split%20Your%20Trip');
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
          title: 'Privacy Policy',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />

      {/* Header Banner */}
      <View
        style={[
          styles.headerCard,
          {
            backgroundColor: isDark ? '#1C2432' : '#F0F4FF',
            borderColor: isDark ? 'rgba(120, 149, 183, 0.25)' : '#DCE5F8',
          },
        ]}
      >
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              Official Privacy Policy
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: isDark ? '#263143' : '#E2E8F0' }]}>
            <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
              by MJ Studios
            </Text>
          </View>
        </View>

        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Your Privacy is Our Priority
        </Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          Split Your Trip (com.splityourtrip) • Last Updated: October 2026
        </Text>

        {/* Core Promise Callout */}
        <View style={[styles.corePromiseBox, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5', borderColor: '#10B981' }]}>
          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
          <Text style={[styles.corePromiseText, { color: isDark ? '#34D399' : '#065F46' }]}>
            <Text style={{ fontWeight: '700' }}>Zero Data Selling:</Text> MJ Studios never sells, rents, or shares your personal travel or financial data with advertisers.
          </Text>
        </View>
      </View>

      {/* Accordion Policy Sections */}
      {POLICY_SECTIONS.map(section => {
        const isExpanded = Boolean(expandedSections[section.id]);
        return (
          <View
            key={section.id}
            style={[
              styles.sectionCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection(section.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconBox, { backgroundColor: section.iconBg }]}>
                <Ionicons name={section.icon} size={18} color={section.iconColor} />
              </View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {section.title}
              </Text>
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </TouchableOpacity>

            {isExpanded && (
              <View style={[styles.sectionBody, { borderTopColor: colors.borderLight }]}>
                {section.content.map((bullet, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <View style={[styles.bulletDot, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.bulletText, { color: colors.text }]}>
                      {bullet}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {/* Contact & Data Deletion Support Card */}
      <View
        style={[
          styles.contactCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.contactHeader}>
          <View style={[styles.iconBox, { backgroundColor: '#FEE2E2' }]}>
            <Ionicons name="mail" size={18} color="#EF4444" />
          </View>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Questions or Data Requests?
            </Text>
            <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
              Contact MJ Studios privacy officer
            </Text>
          </View>
        </View>

        <Text style={[styles.contactBodyText, { color: colors.textSecondary }]}>
          For inquiries, corrections, or complete account deletion requests, reach out directly. We respond within 24 hours.
        </Text>

        <TouchableOpacity
          style={[styles.contactBtn, { backgroundColor: colors.primary }]}
          onPress={handleEmailSupport}
          activeOpacity={0.85}
        >
          <Ionicons name="mail-outline" size={16} color="#FFFFFF" />
          <Text style={styles.contactBtnText}>Email: splityourtrip1@gmail.com</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footerWrap}>
        <Text style={[styles.footerText, { color: colors.textMuted }]}>
          A Product of MJ Studios • Split Your Trip
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
  headerCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginBottom: 14,
  },
  corePromiseBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  corePromiseText: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  sectionSub: {
    fontSize: 11,
    marginTop: 2,
  },
  sectionBody: {
    borderTopWidth: 1,
    padding: 14,
    gap: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  bulletText: {
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  contactCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    marginTop: 6,
  },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  contactBodyText: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  contactBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  footerWrap: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  footerCopyright: {
    fontSize: 11,
  },
});
