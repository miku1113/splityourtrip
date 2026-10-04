import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Modal,
  FlatList,
  TextInput,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/useThemeStore';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import {
  SUPPORTED_CURRENCIES,
  CurrencyItem,
  getCurrencyInfo,
  getUserCurrencyPreference,
  setUserCurrencyPreference,
} from '../src/services/currency';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, toggleTheme } = useTheme();
  const { user, profile, updateProfile, signOut } = useAuthStore();

  const [preferredCurrency, setPreferredCurrency] = useState('INR');
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  useEffect(() => {
    getUserCurrencyPreference().then(code => {
      setPreferredCurrency(code);
    });
  }, []);

  const handleSelectCurrency = async (curr: CurrencyItem) => {
    setPreferredCurrency(curr.code);
    await setUserCurrencyPreference(curr.code);
    if (user?.id) {
      await updateProfile({ currency: curr.code });
    }
    setCurrencyModalVisible(false);
    setCurrencySearch('');
  };

  const handleLogout = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const currencyInfo = getCurrencyInfo(preferredCurrency);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: 100 }]}
      automaticallyAdjustKeyboardInsets={true}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: 'Settings',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
        }}
      />

      {/* Account Info Card */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.userRow}>
          <View style={[styles.avatar, { backgroundColor: colors.primaryLight, overflow: 'hidden' }]}>
            {profile?.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <Text style={[styles.avatarText, { color: colors.primaryDark }]}>
                {(profile?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.userName, { color: colors.text }]}>
              {profile?.full_name || profile?.name || 'Traveler'}
            </Text>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>
              {user?.email || 'Signed in locally'}
            </Text>
            {profile?.phone_number && (
              <Text style={[styles.userPhone, { color: colors.primary }]}>
                {profile.phone_number}
              </Text>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.editProfileBtn, { borderColor: colors.border }]}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <Ionicons name="person-outline" size={16} color={colors.primary} />
          <Text style={[styles.editProfileText, { color: colors.primary }]}>
            Edit Full Profile
          </Text>
        </TouchableOpacity>
      </View>

      {/* App Preferences */}
      <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>PREFERENCES</Text>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        {/* Dark / Light Theme Toggle */}
        <View style={[styles.settingRow, { borderBottomColor: colors.borderLight }]}>
          <View style={styles.settingLabelRow}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF' },
              ]}
            >
              <Ionicons
                name={isDark ? 'moon' : 'sunny'}
                size={18}
                color={colors.primary}
              />
            </View>
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Dark Mode</Text>
              <Text style={[styles.settingSub, { color: colors.textSecondary }]}>
                {isDark ? 'Dark theme is active (Default)' : 'Light theme is active'}
              </Text>
            </View>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: '#D1D5DB', true: colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Global Currency Preference */}
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setCurrencyModalVisible(true)}
        >
          <View style={styles.settingLabelRow}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#ECFDF5' },
              ]}
            >
              <Ionicons name="cash-outline" size={18} color={colors.success} />
            </View>
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Default Currency
              </Text>
              <Text style={[styles.settingSub, { color: colors.textSecondary }]}>
                Used across your trips and splits
              </Text>
            </View>
          </View>
          <View style={styles.currValPill}>
            <Text style={{ fontSize: 16, marginRight: 4 }}>{currencyInfo.flag}</Text>
            <Text style={[styles.currValText, { color: colors.primary }]}>
              {currencyInfo.code} ({currencyInfo.symbol})
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
      </View>

      {/* About Section */}
      <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>ABOUT</Text>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={[styles.settingRow, { borderBottomColor: colors.borderLight }]}>
          <View style={styles.settingLabelRow}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : '#EFF6FF' },
              ]}
            >
              <Ionicons name="information-circle-outline" size={18} color="#3B82F6" />
            </View>
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>App Name</Text>
              <Text style={[styles.settingSub, { color: colors.textSecondary }]}>
                Split Your Trip
              </Text>
            </View>
          </View>
          <Text style={[styles.versionTag, { color: colors.textMuted }]}>v2.0.0</Text>
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingLabelRow}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7' },
              ]}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color="#F59E0B" />
            </View>
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Settlement Engine
              </Text>
              <Text style={[styles.settingSub, { color: colors.textSecondary }]}>
                Smart Debt-Simplification Algorithm
              </Text>
            </View>
          </View>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        </View>
      </View>

      {/* Sign Out / Switch Account */}
      {user ? (
        <TouchableOpacity
          style={[
            styles.logoutBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.danger,
            },
          ]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={[styles.logoutBtnText, { color: colors.danger }]}>
            Sign Out of Account
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.loginBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(auth)/login')}
        >
          <Ionicons name="log-in-outline" size={18} color="#FFFFFF" />
          <Text style={styles.loginBtnText}>Sign In / Create Account</Text>
        </TouchableOpacity>
      )}

      {/* Currency Picker Modal */}
      <Modal visible={currencyModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Select Default Currency
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setCurrencyModalVisible(false);
                  setCurrencySearch('');
                }}
              >
                <Ionicons name="close-circle" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[
                styles.modalSearchInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="Search currency or country..."
              placeholderTextColor={colors.textMuted}
              value={currencySearch}
              onChangeText={setCurrencySearch}
            />

            <FlatList
              data={SUPPORTED_CURRENCIES.filter(
                (c: CurrencyItem) =>
                  c.name.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.code.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.country.toLowerCase().includes(currencySearch.toLowerCase())
              )}
              keyExtractor={item => item.code}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => {
                const isSelected = preferredCurrency === item.code;
                return (
                  <TouchableOpacity
                    style={[
                      styles.currencyRow,
                      { borderBottomColor: colors.borderLight },
                      isSelected && {
                        backgroundColor: isDark
                          ? 'rgba(99, 102, 241, 0.15)'
                          : '#EEF2FF',
                      },
                    ]}
                    onPress={() => handleSelectCurrency(item)}
                  >
                    <Text style={{ fontSize: 24, marginRight: 14 }}>{item.flag}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.currencyRowCode, { color: colors.text }]}>
                        {item.code} ({item.symbol}) - {item.name}
                      </Text>
                      <Text style={[styles.currencyRowCountry, { color: colors.textSecondary }]}>
                        {item.country}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 72,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '800',
  },
  userName: {
    fontSize: 17,
    fontWeight: '700',
  },
  userEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  userPhone: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    marginTop: 4,
  },
  editProfileText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  settingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  settingSub: {
    fontSize: 12,
    marginTop: 2,
  },
  currValPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  currValText: {
    fontSize: 14,
    fontWeight: '700',
  },
  versionTag: {
    fontSize: 13,
    fontWeight: '600',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 8,
    marginTop: 6,
  },
  logoutBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    marginTop: 6,
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderTopWidth: 1,
    maxHeight: '75%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSearchInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 14,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderBottomWidth: 1,
  },
  currencyRowCode: {
    fontSize: 15,
    fontWeight: '700',
  },
  currencyRowCountry: {
    fontSize: 12,
    marginTop: 2,
  },
});
