import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { useTripStore } from '../../src/features/trips/useTripStore';
import { theme } from '../../src/theme/colors';
import { useTheme } from '../../src/theme/useThemeStore';

export default function JoinTripScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { user, profile } = useAuthStore();
  const { joinTripByCode } = useTripStore();
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!code) return;
    if (!user) {
      router.replace('/(auth)/login');
      return;
    }
    setJoining(true);
    setErrorMsg(null);

    const success = await joinTripByCode(
      code,
      user.id,
      profile?.full_name || profile?.name || 'Friend'
    );

    setJoining(false);
    if (success) {
      router.replace('/(tabs)');
    } else {
      setErrorMsg('Invalid or expired invite code.');
    }
  };

  const handleDecline = () => {
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Join Trip' }} />

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="mail-open" size={36} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>You've been invited!</Text>
        <Text style={[styles.desc, { color: colors.textSecondary }]}>
          You were invited to join an active trip expense group on Split Your Trip.
        </Text>

        <View
          style={[
            styles.codeBox,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.codeLabel, { color: colors.textMuted }]}>INVITE CODE</Text>
          <Text style={[styles.codeValue, { color: colors.primary }]}>{code}</Text>
        </View>

        {errorMsg && (
          <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg }]}>
            <Text style={[styles.errorText, { color: colors.danger }]}>{errorMsg}</Text>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptBtn, { backgroundColor: colors.primary }]}
            onPress={handleAccept}
            disabled={joining}
          >
            {joining ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.acceptBtnText}>Accept & Join</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.declineBtn, { borderColor: colors.border }]}
            onPress={handleDecline}
          >
            <Text style={[styles.declineBtnText, { color: colors.textSecondary }]}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 3,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.colors.text,
  },
  desc: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: theme.spacing.lg,
  },
  codeBox: {
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
    letterSpacing: 1,
  },
  codeValue: {
    fontSize: 24,
    fontWeight: '800',
    color: theme.colors.primary,
    letterSpacing: 3,
    marginTop: 2,
  },
  errorBanner: {
    backgroundColor: theme.colors.dangerBg,
    padding: 10,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.md,
    width: '100%',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  acceptBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  acceptBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  declineBtn: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  declineBtnText: {
    color: theme.colors.textSecondary,
    fontWeight: '600',
    fontSize: 15,
  },
});
