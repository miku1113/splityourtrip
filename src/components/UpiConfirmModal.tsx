import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useThemeStore';
import { useResponsive } from '../theme/responsive';
import { DraggableBottomSheet } from './DraggableBottomSheet';
import { useUpiPaymentStore } from '../features/settlements/useUpiPaymentStore';
import { formatCurrencyAmount } from '../services/currency';

export default function UpiConfirmModal() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { isSmall, scaleFont: sf } = useResponsive();

  const {
    showConfirmModal,
    pendingPayment,
    isSubmitting,
    dismissConfirmModal,
    confirmAndSettle,
  } = useUpiPaymentStore();

  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);

  if (!pendingPayment) return null;

  const handlePickScreenshot = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!res.canceled && res.assets && res.assets[0]?.uri) {
        setScreenshotUri(res.assets[0].uri);
      }
    } catch (e: any) {
      Alert.alert('Notice', 'Could not open photo gallery.');
    }
  };

  const handleConfirm = async () => {
    await confirmAndSettle(screenshotUri);
    setScreenshotUri(null);
  };

  const handleDismiss = () => {
    setScreenshotUri(null);
    dismissConfirmModal();
  };

  const formattedAmount = formatCurrencyAmount(
    pendingPayment.amountPaise,
    pendingPayment.currency || 'INR'
  );

  return (
    <DraggableBottomSheet
      visible={showConfirmModal}
      onClose={handleDismiss}
      defaultHeight="60%"
      maxHeight="85%"
      sheetStyle={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        maxWidth: 640,
        alignSelf: 'center',
        width: '100%',
        paddingBottom: Math.max(insets.bottom, 20),
      }}
    >
      <View style={styles.container}>
        {/* Header Icon & Title */}
        <View style={styles.headerRow}>
          <View style={[styles.upiIconBadge, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#DCFCE7' }]}>
            <Ionicons name="card" size={24} color="#10B981" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.title, { color: colors.text, fontSize: sf(17) }]}>
              Did you complete the payment?
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary, fontSize: sf(13) }]}>
              Returned from UPI app
            </Text>
          </View>
        </View>

        {/* Payment Summary Card */}
        <View style={[styles.summaryCard, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <View style={styles.summaryTopRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Payment to</Text>
            <Text style={[styles.summaryReceiver, { color: colors.text }]}>{pendingPayment.receiverName}</Text>
          </View>
          {pendingPayment.tripName ? (
            <View style={styles.summaryTripRow}>
              <Ionicons name="airplane-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.summaryTripName, { color: colors.textSecondary }]}>
                {pendingPayment.tripName}
              </Text>
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.amountRow}>
            <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>Amount</Text>
            <Text
              style={[styles.amountValue, { color: '#10B981', fontSize: sf(24) }]}
              numberOfLines={1}
              adjustsFontSizeToFit={true}
              minimumFontScale={0.72}
            >
              {formattedAmount}
            </Text>
          </View>
        </View>

        {/* Optional Screenshot Attachment */}
        {screenshotUri ? (
          <View style={[styles.previewBox, { borderColor: colors.border, backgroundColor: colors.inputBackground }]}>
            <Image source={{ uri: screenshotUri }} style={styles.previewImage} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.previewTitle, { color: colors.text }]}>Screenshot Attached</Text>
              <Text style={[styles.previewSub, { color: colors.textSecondary }]}>
                Will be attached as payment proof
              </Text>
            </View>
            <TouchableOpacity onPress={() => setScreenshotUri(null)}>
              <Ionicons name="close-circle" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.attachBtn, { borderColor: colors.border, backgroundColor: colors.inputBackground }]}
            onPress={handlePickScreenshot}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={18} color={colors.primary} />
            <Text style={[styles.attachBtnText, { color: colors.primary, fontSize: sf(13) }]}>
              Attach Payment Screenshot (Optional)
            </Text>
          </TouchableOpacity>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          {/* Confirm & Deduct */}
          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: '#10B981', opacity: isSubmitting ? 0.7 : 1 }]}
            onPress={handleConfirm}
            disabled={isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                <Text style={[styles.confirmBtnText, { fontSize: sf(15) }]}>
                  Yes, Confirm & Deduct
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Not Completed / Failed */}
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: colors.border }]}
            onPress={handleDismiss}
            disabled={isSubmitting}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelBtnText, { color: colors.textSecondary, fontSize: sf(14) }]}>
              Payment Failed / Not Completed
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </DraggableBottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  upiIconBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 2,
  },
  summaryCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  summaryReceiver: {
    fontSize: 15,
    fontWeight: '700',
  },
  summaryTripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  summaryTripName: {
    fontSize: 12,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amountLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  amountValue: {
    fontWeight: '800',
  },
  previewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  previewImage: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  previewSub: {
    fontSize: 11,
    marginTop: 2,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  attachBtnText: {
    fontWeight: '600',
  },
  actionsContainer: {
    gap: 10,
    marginTop: 4,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontWeight: '600',
  },
});
