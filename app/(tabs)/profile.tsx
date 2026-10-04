import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  FlatList,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { useTheme } from '../../src/theme/useThemeStore';
import { SUPPORTED_CURRENCIES, CurrencyItem, getCurrencyInfo } from '../../src/services/currency';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, isConfigured, updateProfile, fetchProfile, signOut } = useAuthStore();
  const { colors } = useTheme();

  const [name, setName] = useState(profile?.full_name || profile?.name || 'Traveler');
  const [upiId, setUpiId] = useState(profile?.upi_id || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url || null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyItem>(
    getCurrencyInfo(profile?.currency || 'INR')
  );
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [photoPickerVisible, setPhotoPickerVisible] = useState(false);

  // Automatically fetch fresh profile data from Supabase whenever user opens this tab
  useFocusEffect(
    React.useCallback(() => {
      fetchProfile();
    }, [fetchProfile])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchProfile();
    } finally {
      setIsRefreshing(false);
    }
  };

  React.useEffect(() => {
    if (profile?.full_name || profile?.name) {
      setName(profile.full_name || profile.name || '');
    }
    if (profile?.upi_id !== undefined) {
      setUpiId(profile.upi_id || '');
    }
    if (profile?.currency) {
      setSelectedCurrency(getCurrencyInfo(profile.currency));
    }
    if (profile?.phone_number !== undefined) {
      const raw = (profile.phone_number || '').trim();
      const currentDial = getCurrencyInfo(profile.currency || 'INR').dialCode;
      if (raw.startsWith(currentDial)) {
        setPhoneNumber(raw.slice(currentDial.length).trim());
      } else {
        setPhoneNumber(raw);
      }
    }
    if (profile?.avatar_url !== undefined) {
      setAvatarUrl(profile.avatar_url);
      setImageLoadError(false);
    }
  }, [profile]);

  const handlePickFromGallery = async () => {
    setPhotoPickerVisible(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUri = asset.base64
          ? `data:image/jpeg;base64,${asset.base64}`
          : asset.uri;
        setImageLoadError(false);
        setAvatarUrl(dataUri);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not pick photo from gallery.');
    }
  };

  const handleTakePhoto = async () => {
    setPhotoPickerVisible(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission', 'Please enable camera permission in device settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUri = asset.base64
          ? `data:image/jpeg;base64,${asset.base64}`
          : asset.uri;
        setImageLoadError(false);
        setAvatarUrl(dataUri);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not capture photo.');
    }
  };

  const handleRemovePhoto = () => {
    setPhotoPickerVisible(false);
    setImageLoadError(false);
    setAvatarUrl(null);
  };

  // Detect if any field has unsaved changes compared to the database profile
  const currentDialCode = selectedCurrency.dialCode;
  const rawProfilePhone = (profile?.phone_number || '').trim();
  const savedPhoneDigits = rawProfilePhone.startsWith(currentDialCode)
    ? rawProfilePhone.slice(currentDialCode.length).trim()
    : rawProfilePhone;

  const savedName = (profile?.full_name || profile?.name || '').trim();
  const savedUpiId = (profile?.upi_id || '').trim();
  const savedAvatar = profile?.avatar_url || null;
  const savedCurrencyCode = profile?.currency || 'INR';

  const isDirty =
    name.trim() !== savedName ||
    upiId.trim() !== savedUpiId ||
    phoneNumber.trim() !== savedPhoneDigits ||
    avatarUrl !== savedAvatar ||
    selectedCurrency.code !== savedCurrencyCode;

  const handleSave = async () => {
    if (isSaving || !isDirty) return;
    setIsSaving(true);

    const safetyTimer = setTimeout(() => {
      setIsSaving(false);
    }, 10000);

    try {
      let cleanPhone = phoneNumber.trim();
      if (cleanPhone) {
        if (!cleanPhone.startsWith('+')) {
          const digitsOnly = cleanPhone.replace(/[^0-9]/g, '');
          cleanPhone = `${selectedCurrency.dialCode} ${digitsOnly}`;
        }
      }

      const res = await updateProfile({
        full_name: name.trim(),
        name: name.trim(),
        avatar_url: avatarUrl,
        upi_id: upiId.trim(),
        phone_number: cleanPhone,
        currency: selectedCurrency.code,
        country: selectedCurrency.country,
      });

      clearTimeout(safetyTimer);
      setIsSaving(false);

      if (res?.error) {
        Alert.alert('Save Failed', res.error.message);
      } else {
        setSavedMsg(true);
        Alert.alert('Profile Saved', 'Your profile details, mobile number, UPI ID, and profile picture have been updated in Supabase.');
        setTimeout(() => setSavedMsg(false), 3000);
      }
    } catch (err: any) {
      clearTimeout(safetyTimer);
      setIsSaving(false);
      Alert.alert('Error', err?.message || 'Failed to update profile.');
    } finally {
      clearTimeout(safetyTimer);
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };


  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingBottom: 160 }]}
        automaticallyAdjustKeyboardInsets={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
      {/* Profile Header Card */}
      <View
        style={[
          styles.headerCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.avatarWrapper}
          activeOpacity={0.8}
          onPress={() => setPhotoPickerVisible(true)}
        >
          {avatarUrl && !imageLoadError ? (
            <Image
              key={avatarUrl}
              source={{ uri: avatarUrl }}
              style={styles.avatarImage}
              onError={(e) => {
                console.log('Avatar image load notice:', e.nativeEvent?.error);
                setImageLoadError(true);
              }}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>
                {(profile?.name || name || 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.card }]}>
            <Ionicons name="camera" size={14} color="#FFFFFF" />
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setPhotoPickerVisible(true)}>
          <Text style={[styles.changePhotoText, { color: colors.primary }]}>
            {avatarUrl ? 'Change Profile Photo' : '+ Add Profile Photo'}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.userName, { color: colors.text }]}>{name}</Text>
        <Text style={[styles.userEmail, { color: colors.textSecondary }]}>
          {user?.email || 'Logged Out'}
        </Text>

        <View style={[styles.statusBadge, { backgroundColor: colors.borderLight }]}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isConfigured ? colors.success : colors.warning },
            ]}
          />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            {isConfigured ? 'Supabase Backend Connected' : 'Local Preview Mode'}
          </Text>
        </View>

        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, fontWeight: '500' }}>
          App Version 1.0.14 (Build 15)
        </Text>
      </View>


      {/* Edit Form */}
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment & Profile Details</Text>

        {savedMsg && (
          <View style={[styles.savedBanner, { backgroundColor: colors.successBg }]}>
            <Text style={[styles.savedText, { color: colors.success }]}>
              ✓ Profile updated and saved to Supabase
            </Text>
          </View>
        )}

        <Text style={[styles.label, { color: colors.textSecondary }]}>Display Name</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          UPI ID (for auto-repayments & settlements)
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          value={upiId}
          onChangeText={setUpiId}
          placeholder="e.g. 9426240803@upi or name@okhdfcbank"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
        <Text style={[styles.fieldHelp, { color: colors.textMuted }]}>
          Stored in database. Friends can pay you directly via UPI using this VPA address.
        </Text>

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Mobile Number
        </Text>
        <View style={styles.phoneInputRow}>
          <TouchableOpacity
            style={[
              styles.phoneDialCodeBox,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
              },
            ]}
            onPress={() => setCurrencyModalVisible(true)}
          >
            <Text style={styles.phoneFlagText}>{selectedCurrency.flag}</Text>
            <Text style={[styles.phoneDialCodeText, { color: colors.text }]}>
              {selectedCurrency.dialCode}
            </Text>
          </TouchableOpacity>
          <TextInput
            style={[
              styles.phoneInput,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="9876543210"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          />
        </View>
        <Text style={[styles.fieldHelp, { color: colors.textMuted }]}>
          Saved with country code {selectedCurrency.dialCode} ({selectedCurrency.country}) for auto-linking splits.
        </Text>

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Preferred Currency & Country
        </Text>
        <TouchableOpacity
          style={[
            styles.currencyPickerBtn,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
            },
          ]}
          onPress={() => setCurrencyModalVisible(true)}
        >
          <View style={styles.currencyBtnLeft}>
            <Text style={styles.flagText}>{selectedCurrency.flag}</Text>
            <View>
              <Text style={[styles.currencyNameText, { color: colors.text }]}>
                {selectedCurrency.country} ({selectedCurrency.name})
              </Text>
              <Text style={[styles.currencySubText, { color: colors.textSecondary }]}>
                Symbol: {selectedCurrency.symbol} • Code: {selectedCurrency.code}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {(isDirty || isSaving || savedMsg) && (
          <TouchableOpacity
            style={[
              styles.saveBtn,
              { backgroundColor: savedMsg ? colors.success : colors.primary },
              isSaving && { opacity: 0.75 },
            ]}
            onPress={handleSave}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <View style={styles.btnRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.saveBtnText}>Saving changes...</Text>
              </View>
            ) : savedMsg ? (
              <View style={styles.btnRow}>
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                <Text style={styles.saveBtnText}>Saved Successfully!</Text>
              </View>
            ) : (
              <View style={styles.btnRow}>
                <Ionicons name="save-outline" size={18} color="#FFFFFF" />
                <Text style={styles.saveBtnText}>Save Changes</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Supabase Integration Info */}
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Backend Architecture</Text>
        <Text style={[styles.backendDesc, { color: colors.textSecondary }]}>
          • Database: Supabase Postgres with Row Level Security (RLS)
          {'\n'}• Storage: Private bucket `payment-screenshots`
          {'\n'}• Realtime: Live sync for expenses, balances & trip chat
          {'\n'}• Currency: Integer Paise (1 INR = 100 paise)
        </Text>
      </View>

      {/* Auth Action */}
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
          <Text style={[styles.logoutBtnText, { color: colors.danger }]}>
            Sign Out / Switch Account
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.saveBtn,
            {
              backgroundColor: colors.primary,
              marginTop: 12,
            },
          ]}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text style={styles.saveBtnText}>Sign In / Create Account</Text>
        </TouchableOpacity>
      )}
      </ScrollView>

      {/* Currency & Country Selector Modal */}
      <Modal visible={currencyModalVisible} transparent animationType="slide">
        <View style={styles.currencyModalOverlay}>
          <View
            style={[
              styles.currencyModalContent,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Select Preferred Currency
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
              placeholder="Search country, currency, or code..."
              placeholderTextColor={colors.textMuted}
              value={currencySearch}
              onChangeText={setCurrencySearch}
            />

            <FlatList
              data={SUPPORTED_CURRENCIES.filter(
                c =>
                  c.country.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.name.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.code.toLowerCase().includes(currencySearch.toLowerCase())
              )}
              keyExtractor={item => item.code}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => {
                const isSelected = selectedCurrency.code === item.code;
                return (
                  <TouchableOpacity
                    style={[
                      styles.currencyRow,
                      { borderBottomColor: colors.borderLight },
                      isSelected && { backgroundColor: colors.primaryLight },
                    ]}
                    onPress={() => {
                      setSelectedCurrency(item);
                      setCurrencyModalVisible(false);
                      setCurrencySearch('');
                    }}
                  >
                    <Text style={styles.currencyRowFlag}>{item.flag}</Text>
                    <View style={styles.currencyRowInfo}>
                      <Text style={[styles.currencyRowCountry, { color: colors.text }]}>
                        {item.country}
                      </Text>
                      <Text style={[styles.currencyRowSub, { color: colors.textSecondary }]}>
                        {item.name} • {item.symbol} {item.code}
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
        </View>
      </Modal>

      {/* Photo Picker Modal */}
      <Modal visible={photoPickerVisible} transparent animationType="fade">
        <View style={styles.photoModalOverlay}>
          <View
            style={[
              styles.photoModalContent,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Profile Photo</Text>
              <TouchableOpacity onPress={() => setPhotoPickerVisible(false)}>
                <Ionicons name="close-circle" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.photoActionRow, { borderBottomColor: colors.borderLight }]}
              onPress={handlePickFromGallery}
            >
              <View style={[styles.photoActionIcon, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="images-outline" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.photoActionTitle, { color: colors.text }]}>
                  Choose from Gallery
                </Text>
                <Text style={[styles.photoActionSub, { color: colors.textSecondary }]}>
                  Pick an existing image from your photo album
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.photoActionRow, { borderBottomColor: colors.borderLight }]}
              onPress={handleTakePhoto}
            >
              <View style={[styles.photoActionIcon, { backgroundColor: colors.cardSecondary }]}>
                <Ionicons name="camera-outline" size={22} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.photoActionTitle, { color: colors.text }]}>Take Photo</Text>
                <Text style={[styles.photoActionSub, { color: colors.textSecondary }]}>
                  Use your device camera to capture a new photo
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            {avatarUrl && (
              <TouchableOpacity
                style={styles.photoActionRow}
                onPress={handleRemovePhoto}
              >
                <View style={[styles.photoActionIcon, { backgroundColor: colors.dangerBg }]}>
                  <Ionicons name="trash-outline" size={22} color={colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.photoActionTitle, { color: colors.danger }]}>
                    Remove Current Photo
                  </Text>
                  <Text style={[styles.photoActionSub, { color: colors.textSecondary }]}>
                    Revert to initial avatar
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  headerCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 4,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  changePhotoText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 8,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  photoModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
  },
  photoActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: 1,
  },
  photoActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoActionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  photoActionSub: {
    fontSize: 12,
    marginTop: 2,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
  },
  userEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 9999,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  sectionCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionIconTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  currentThemePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  currentThemeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  themeToggleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  themeCardBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 14,
    borderWidth: 2,
  },
  themeCardActive: {
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  themeOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  themeEmoji: {
    fontSize: 24,
  },
  themeOptionName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  themeOptionBadge: {
    fontSize: 11,
    color: '#34D399',
    fontWeight: '600',
  },
  themeOptionSub: {
    fontSize: 11,
    fontWeight: '500',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 4,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  phoneDialCodeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  phoneFlagText: {
    fontSize: 18,
  },
  phoneDialCodeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  fieldHelp: {
    fontSize: 12,
    marginBottom: 16,
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  savedBanner: {
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  savedText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  backendDesc: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  logoutBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  logoutBtnText: {
    fontWeight: '600',
    fontSize: 14,
  },
  currencyPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  currencyBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  flagText: {
    fontSize: 20,
  },
  currencyNameText: {
    fontSize: 14,
    fontWeight: '700',
  },
  currencySubText: {
    fontSize: 12,
    marginTop: 2,
  },
  currencyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  currencyModalContent: {
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
    paddingHorizontal: 12,
    borderRadius: 10,
    borderBottomWidth: 1,
  },
  currencyRowFlag: {
    fontSize: 24,
    marginRight: 14,
  },
  currencyRowInfo: {
    flex: 1,
  },
  currencyRowCountry: {
    fontSize: 15,
    fontWeight: '700',
  },
  currencyRowSub: {
    fontSize: 12,
    marginTop: 2,
  },
});

