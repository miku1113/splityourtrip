import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Modal,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { useTripStore } from '../../src/features/trips/useTripStore';
import { useTheme } from '../../src/theme/useThemeStore';
import { SUPPORTED_CURRENCIES, CurrencyItem } from '../../src/services/currency';
import { AppLogo } from '../../src/components/AppLogo';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const {
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    verifyOtp,
    sendPasswordResetEmail,
    resetPasswordWithOtp,
    isConfigured,
  } = useAuthStore();
  const fetchTrips = useTripStore(state => state.fetchTrips);

  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyItem>(SUPPORTED_CURRENCIES[0]);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  // OTP Verification state
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [otpToken, setOtpToken] = useState('');

  // Forgot Password modal state
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotStep, setForgotStep] = useState<'request' | 'verify'>('request');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotShowPassword, setForgotShowPassword] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleSignIn = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMsg('Password must be at least 6 characters');
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    const { error } = await signInWithPassword(cleanEmail, password);
    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes('not confirmed')) {
        setErrorMsg('Email not confirmed. Enter the 6-digit confirmation code below:');
        setAwaitingOtp(true);
      } else {
        setErrorMsg(error.message);
      }
      return;
    }

    // Success: Immediate transition to main app (background sync loads data)
    router.replace('/(tabs)');
  };

  const handleSendRecoveryCode = async () => {
    const clean = forgotEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setForgotError('Please enter a valid email address');
      return;
    }
    setForgotError(null);
    setForgotSuccess(null);
    setForgotLoading(true);

    const { error } = await sendPasswordResetEmail(clean);
    setForgotLoading(false);

    if (error) {
      setForgotError(error.message);
      return;
    }

    setForgotStep('verify');
    setForgotSuccess(`Recovery code sent to ${clean}. Please check your inbox or spam.`);
  };

  const handleResetPassword = async () => {
    if (!forgotOtp.trim() || forgotOtp.trim().length < 6) {
      setForgotError('Please enter the 6-digit recovery code');
      return;
    }
    if (!forgotNewPassword || forgotNewPassword.length < 6) {
      setForgotError('New password must be at least 6 characters');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Passwords do not match');
      return;
    }

    setForgotError(null);
    setForgotSuccess(null);
    setForgotLoading(true);

    const clean = forgotEmail.trim().toLowerCase();
    const { error } = await resetPasswordWithOtp(clean, forgotOtp.trim(), forgotNewPassword);
    setForgotLoading(false);

    if (error) {
      setForgotError(error.message);
      return;
    }

    setForgotModalVisible(false);
    router.replace('/(tabs)');
  };

  const handleSignUp = async () => {
    if (!fullName.trim()) {
      setErrorMsg('Please enter your full name');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Please enter a valid email address');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMsg('Password must be at least 6 characters');
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    const fullPhone = phoneNumber.trim() ? `${selectedCurrency.dialCode} ${phoneNumber.trim()}` : '';

    const { error, sessionActive } = await signUpWithPassword(
      email.trim(),
      password,
      fullName.trim(),
      fullPhone,
      selectedCurrency.code,
      selectedCurrency.country
    );
    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
      if (error.message.toLowerCase().includes('already exists')) {
        setActiveTab('signin');
      }
      return;
    }

    if (sessionActive) {
      // Immediate session established
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        fetchTrips(currentUser.id).catch(() => {});
      }
      router.replace('/(tabs)');
    } else {
      // Email confirmation code was dispatched
      setAwaitingOtp(true);
      setInfoMsg(`We sent a 6-digit verification code to ${email.trim()}. Enter it below to activate your account.`);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpToken.trim() || otpToken.trim().length < 6) {
      setErrorMsg('Please enter the complete 6-digit code');
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    const { error } = await verifyOtp(email.trim(), otpToken.trim());
    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // Success: Load trips and navigate to main app
    const currentUser = useAuthStore.getState().user;
    if (currentUser) {
      await fetchTrips(currentUser.id);
    }
    router.replace('/(tabs)');
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);
    const { error } = await signInWithGoogle();
    setLoading(false);

    if (error) {
      if (
        error.message.toLowerCase().includes('cancelled') ||
        error.message.toLowerCase().includes('canceled')
      ) {
        return;
      }
      setErrorMsg(error.message);
      return;
    }

    const currentUser = useAuthStore.getState().user;
    if (currentUser) {
      await fetchTrips(currentUser.id);
      router.replace('/(tabs)');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={Platform.OS === 'android'}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 16,
            paddingBottom: Math.max(insets.bottom, 24) + 140,
          },
        ]}
        automaticallyAdjustKeyboardInsets={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Header */}
        <View style={styles.header}>
          <AppLogo size={80} showGlow style={{ marginBottom: 16 }} />
          <Text style={[styles.title, { color: colors.text }]}>Split Your Trip</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Smarter group expenses, instant UPI share & automated settlements.
          </Text>
        </View>

        {/* Auth Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          {awaitingOtp ? (
            /* OTP Verification Screen */
            <View>
              <View style={styles.otpHeader}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => {
                    setAwaitingOtp(false);
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                >
                  <Ionicons name="arrow-back" size={20} color={colors.text} />
                  <Text style={[styles.backBtnText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Verify Your Email</Text>
              </View>

              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                {infoMsg || `Enter the 6-digit verification code sent to ${email}`}
              </Text>

              {errorMsg && (
                <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg }]}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                  <Text style={[styles.errorText, { color: colors.danger }]}>{errorMsg}</Text>
                </View>
              )}

              <Text style={[styles.label, { color: colors.text }]}>6-Digit Confirmation Code</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.otpInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="123456"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={8}
                value={otpToken}
                onChangeText={setOtpToken}
                autoFocus
              />

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  { backgroundColor: colors.primary },
                  loading && styles.btnDisabled,
                ]}
                onPress={handleVerifyOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Verify & Enter</Text>
                )}
              </TouchableOpacity>

              <View style={styles.otpAuxActions}>
                <TouchableOpacity
                  style={styles.resendBtn}
                  onPress={async () => {
                    setLoading(true);
                    setErrorMsg(null);
                    const { resendVerification } = useAuthStore.getState();
                    const res = await resendVerification(email);
                    setLoading(false);
                    if (res.error) {
                      setErrorMsg(res.error.message);
                    } else {
                      setInfoMsg(`A fresh verification email was sent to ${email}.`);
                    }
                  }}
                  disabled={loading}
                >
                  <Text style={[styles.resendBtnText, { color: colors.primary }]}>
                    🔄 Resend Confirmation Email
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.linkVerifiedBtn}
                  onPress={async () => {
                    setActiveTab('signin');
                    setAwaitingOtp(false);
                    setInfoMsg('Email confirmed! Enter your password to sign in.');
                  }}
                >
                  <Text style={[styles.linkVerifiedText, { color: colors.textSecondary }]}>
                    Already clicked the link? Sign in here
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* Sign In / Sign Up Card */
            <View>
              {/* Tab Switcher */}
              <View
                style={[
                  styles.tabSwitcher,
                  { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.tabBtn,
                    activeTab === 'signin' && {
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={() => {
                    setActiveTab('signin');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                >
                  <Text
                    style={[
                      styles.tabBtnText,
                      {
                        color:
                          activeTab === 'signin'
                            ? colors.primary
                            : colors.textSecondary,
                        fontWeight: activeTab === 'signin' ? '700' : '600',
                      },
                    ]}
                  >
                    Sign In
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.tabBtn,
                    activeTab === 'signup' && {
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={() => {
                    setActiveTab('signup');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                >
                  <Text
                    style={[
                      styles.tabBtnText,
                      {
                        color:
                          activeTab === 'signup'
                            ? colors.primary
                            : colors.textSecondary,
                        fontWeight: activeTab === 'signup' ? '700' : '600',
                      },
                    ]}
                  >
                    Create Account
                  </Text>
                </TouchableOpacity>
              </View>

              {errorMsg && (
                <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg }]}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                  <Text style={[styles.errorText, { color: colors.danger }]}>{errorMsg}</Text>
                </View>
              )}

              {infoMsg && (
                <View style={[styles.infoBanner, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name="information-circle" size={18} color={colors.primary} />
                  <Text style={[styles.infoText, { color: colors.primaryDark }]}>{infoMsg}</Text>
                </View>
              )}

              {activeTab === 'signup' && (
                <>
                  <Text style={[styles.label, { color: colors.text }]}>Full Name</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name="person-outline"
                      size={18}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.textInput, { color: colors.text }]}
                      placeholder="e.g. Rahul Sharma"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="words"
                      value={fullName}
                      onChangeText={setFullName}
                    />
                  </View>

                  <Text style={[styles.label, { color: colors.text }]}>Mobile Number</Text>
                  <View
                    style={[
                      styles.phoneInputContainer,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={[styles.dialCodeBtn, { borderRightColor: colors.border }]}
                      onPress={() => setCurrencyModalVisible(true)}
                    >
                      <Text style={styles.flagText}>{selectedCurrency.flag}</Text>
                      <Text style={[styles.dialCodeText, { color: colors.text }]}>
                        {selectedCurrency.dialCode}
                      </Text>
                      <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.phoneTextInput, { color: colors.text }]}
                      placeholder="9876543210"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="phone-pad"
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                    />
                  </View>

                  <Text style={[styles.label, { color: colors.text }]}>Country & Currency</Text>
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
                          Default Currency: {selectedCurrency.symbol} {selectedCurrency.code}
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </>
              )}

              <Text style={[styles.label, { color: colors.text }]}>Email Address</Text>
              <View
                style={[
                  styles.inputContainer,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color={colors.textMuted}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.textInput, { color: colors.text }]}
                  placeholder="name@example.com"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              <Text style={[styles.label, { color: colors.text }]}>Password</Text>
              <View
                style={[
                  styles.inputContainer,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color={colors.textMuted}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.textInput, { color: colors.text }]}
                  placeholder="Min 6 characters"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              {activeTab === 'signin' && (
                <View style={styles.forgotPasswordRow}>
                  <TouchableOpacity
                    onPress={() => {
                      setForgotEmail(email.trim().toLowerCase());
                      setForgotOtp('');
                      setForgotNewPassword('');
                      setForgotConfirmPassword('');
                      setForgotError(null);
                      setForgotSuccess(null);
                      setForgotStep('request');
                      setForgotModalVisible(true);
                    }}
                  >
                    <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>
                      Forgot Password?
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  { backgroundColor: colors.primary },
                  loading && styles.btnDisabled,
                ]}
                onPress={activeTab === 'signin' ? handleSignIn : handleSignUp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {activeTab === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerText, { color: colors.textMuted }]}>OR</Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>

              {/* Google Sign In */}
              <TouchableOpacity
                style={[
                  styles.googleBtn,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                  loading && styles.btnDisabled,
                ]}
                onPress={handleGoogleSignIn}
                disabled={loading}
              >
                <Ionicons name="logo-google" size={18} color="#EA4335" style={{ marginRight: 10 }} />
                <Text style={[styles.googleBtnText, { color: colors.text }]}>
                  Continue with Google
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Database status indicator */}
          <View style={[styles.configBadge, { borderTopColor: colors.borderLight }]}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConfigured ? colors.success : colors.warning },
              ]}
            />
            <Text style={[styles.configText, { color: colors.textMuted }]}>
              {isConfigured ? 'Connected to Supabase Database' : 'Supabase Not Configured'}
            </Text>
          </View>
        </View>
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
                Select Country & Currency
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
              placeholder="Search country, currency, or dial code..."
              placeholderTextColor={colors.textMuted}
              value={currencySearch}
              onChangeText={setCurrencySearch}
            />

            <FlatList
              data={SUPPORTED_CURRENCIES.filter(
                (c: CurrencyItem) =>
                  c.country.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.name.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.code.toLowerCase().includes(currencySearch.toLowerCase()) ||
                  c.dialCode.includes(currencySearch)
              )}
              keyExtractor={item => item.code}
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 20 }}
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
                        {item.country} <Text style={{ color: colors.textSecondary }}>({item.dialCode})</Text>
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

      {/* Forgot Password Modal */}
      {forgotModalVisible && (
        <Modal visible={forgotModalVisible} transparent animationType="slide">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.forgotModalOverlay}
          >
            <View
              style={[
                styles.forgotModalContent,
                {
                  backgroundColor: colors.card,
                  borderTopColor: colors.border,
                  paddingBottom: Math.max(insets.bottom, 24) + 16,
                },
              ]}
            >
              {/* Header */}
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Reset Password</Text>
                  <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                    {forgotStep === 'request'
                      ? 'Enter your email to receive a recovery code'
                      : `Enter the code sent to ${forgotEmail}`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.closeIconBtn, { backgroundColor: colors.inputBackground }]}
                  onPress={() => {
                    setForgotModalVisible(false);
                    setForgotError(null);
                    setForgotSuccess(null);
                  }}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>

              {forgotError && (
                <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg, marginBottom: 12 }]}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                  <Text style={[styles.errorText, { color: colors.danger }]}>{forgotError}</Text>
                </View>
              )}

              {forgotSuccess && (
                <View style={[styles.infoBanner, { backgroundColor: colors.primaryLight, marginBottom: 12 }]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  <Text style={[styles.infoText, { color: colors.primaryDark }]}>{forgotSuccess}</Text>
                </View>
              )}

              {forgotStep === 'request' ? (
                <View>
                  <Text style={[styles.label, { color: colors.text }]}>Registered Email</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        marginBottom: 16,
                      },
                    ]}
                  >
                    <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.textInput, { color: colors.text }]}
                      placeholder="name@example.com"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      value={forgotEmail}
                      onChangeText={setForgotEmail}
                    />
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      { backgroundColor: colors.primary },
                      forgotLoading && styles.btnDisabled,
                    ]}
                    onPress={handleSendRecoveryCode}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Send Recovery Code</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
                  <Text style={[styles.label, { color: colors.text }]}>6-Digit Recovery Code</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        marginBottom: 12,
                      },
                    ]}
                  >
                    <Ionicons name="key-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.textInput, { color: colors.text, letterSpacing: 3, fontWeight: '700' }]}
                      placeholder="123456"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={6}
                      value={forgotOtp}
                      onChangeText={setForgotOtp}
                    />
                  </View>

                  <Text style={[styles.label, { color: colors.text }]}>New Password</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        marginBottom: 12,
                      },
                    ]}
                  >
                    <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.textInput, { color: colors.text }]}
                      placeholder="Min 6 characters"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry={!forgotShowPassword}
                      value={forgotNewPassword}
                      onChangeText={setForgotNewPassword}
                    />
                    <TouchableOpacity
                      onPress={() => setForgotShowPassword(!forgotShowPassword)}
                      style={styles.eyeBtn}
                    >
                      <Ionicons
                        name={forgotShowPassword ? 'eye-off-outline' : 'eye-outline'}
                        size={20}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.label, { color: colors.text }]}>Confirm New Password</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: colors.border,
                        marginBottom: 16,
                      },
                    ]}
                  >
                    <Ionicons name="shield-checkmark-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.textInput, { color: colors.text }]}
                      placeholder="Re-enter new password"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry={!forgotShowPassword}
                      value={forgotConfirmPassword}
                      onChangeText={setForgotConfirmPassword}
                    />
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      { backgroundColor: colors.primary },
                      forgotLoading && styles.btnDisabled,
                    ]}
                    onPress={handleResetPassword}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Reset Password & Sign In</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ alignItems: 'center', marginTop: 12 }}
                    onPress={() => setForgotStep('request')}
                  >
                    <Text style={{ fontSize: 13, color: colors.textSecondary, fontWeight: '600' }}>
                      Didn't get code? Resend to another email
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: 48,
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  logoIcon: {
    fontSize: 34,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  card: {
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
  },
  tabSwitcher: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabBtnText: {
    fontSize: 14,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  otpHeader: {
    marginBottom: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtnText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
  },
  eyeBtn: {
    padding: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  otpInput: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.65,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
  configBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  configText: {
    fontSize: 12,
    fontWeight: '500',
  },
  otpAuxActions: {
    marginTop: 18,
    alignItems: 'center',
    gap: 12,
  },
  resendBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  resendBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  linkVerifiedBtn: {
    paddingVertical: 6,
  },
  linkVerifiedText: {
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 12,
    fontWeight: '700',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  googleBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  dialCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRightWidth: 1,
    gap: 6,
  },
  flagText: {
    fontSize: 18,
  },
  dialCodeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  phoneTextInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
  },
  currencyPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
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
  forgotPasswordRow: {
    alignItems: 'flex-end',
    marginBottom: 16,
    marginTop: -4,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
  },
  forgotModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  forgotModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderTopWidth: 1,
    maxHeight: '85%',
  },
  modalSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

