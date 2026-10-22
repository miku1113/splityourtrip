import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme/useThemeStore';
import { useTripStore } from '../src/features/trips/useTripStore';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { DraggableBottomSheet } from '../src/components/DraggableBottomSheet';
import {
  getGoogleDriveConfig,
  saveGoogleDriveConfig,
  linkGoogleDriveAccount,
  unlinkGoogleDriveAccount,
  performGoogleDriveBackup,
  restoreFromGoogleDrivePicker,
  exportTripToGoogleDoc,
  GoogleDriveConfig,
} from '../src/services/googleDriveBackupService';

export default function GoogleDriveBackupScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { trips } = useTripStore();
  const { user, profile } = useAuthStore();

  const [config, setConfig] = useState<GoogleDriveConfig>({
    email: null,
    name: null,
    isConnected: false,
    accessToken: null,
    lastBackupDate: null,
    lastBackupSizeBytes: null,
    includeMedia: true,
    wifiOnly: false,
    frequency: 'manual',
  });

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [googleEmailInput, setGoogleEmailInput] = useState('');
  const [freqModalVisible, setFreqModalVisible] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const c = await getGoogleDriveConfig();
    // Default account to logged in user email if not yet set
    if (!c.email && user?.email) {
      c.email = user.email;
      c.name = profile?.full_name || user.email.split('@')[0];
    }
    setConfig(c);
  };

  const handleLinkAccount = async () => {
    if (!googleEmailInput.trim() || !googleEmailInput.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid Google Account email address.');
      return;
    }
    const updated = await linkGoogleDriveAccount(
      googleEmailInput.trim(),
      profile?.full_name || googleEmailInput.split('@')[0]
    );
    setConfig(updated);
    setAccountModalVisible(false);
    setGoogleEmailInput('');
    Alert.alert('Google Account Linked', `Backups will be linked to ${updated.email}`);
  };

  const handleDisconnect = async () => {
    Alert.alert(
      'Disconnect Google Account',
      'Are you sure you want to unlink your Google Drive account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            const updated = await unlinkGoogleDriveAccount();
            setConfig(updated);
          },
        },
      ]
    );
  };

  const handleStartBackup = async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);

    try {
      const res = await performGoogleDriveBackup({ interactive: true });
      await loadConfig();
      Alert.alert(
        'Backup Successful!',
        `Your trips, splits, and messages were packaged (${res.formattedSize}).\n\nChoose 'Save to Drive' from the share sheet to store the file inside your personal Google Drive folder.`
      );
    } catch (err: any) {
      Alert.alert('Backup Error', err?.message || 'Could not complete backup.');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleStartRestore = async () => {
    if (isRestoring) return;

    Alert.alert(
      'Restore from Google Drive',
      'Select your SplitYourTrip backup file (.json) from Google Drive or Files to restore your trips, expenses, and chats to this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose File',
          onPress: async () => {
            setIsRestoring(true);
            try {
              const res = await restoreFromGoogleDrivePicker();
              if (res.success) {
                Alert.alert(
                  'Restore Complete',
                  `Successfully restored ${res.tripsRestored} trip(s), ${res.expensesRestored} expense(s), and ${res.messagesRestored} chat message(s)!`
                );
              }
            } catch (err: any) {
              Alert.alert('Restore Failed', err?.message || 'Could not parse backup file.');
            } finally {
              setIsRestoring(false);
            }
          },
        },
      ]
    );
  };

  const handleExportTripDoc = async (tripId: string) => {
    try {
      await exportTripToGoogleDoc(tripId);
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message || 'Could not export trip summary.');
    }
  };

  const totalPaise = trips.length;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: 60 }]}
    >
      <Stack.Screen
        options={{
          title: 'Google Drive Backup',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
        }}
      />

      {/* Top Banner: Personal Google Drive Backup */}
      <View
        style={[
          styles.statusCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.statusHeaderRow}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: isDark ? 'rgba(37, 211, 102, 0.2)' : '#DCFCE7' },
            ]}
          >
            <Ionicons name="logo-google" size={26} color="#25D366" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              Personal Google Drive Backup
            </Text>
            <Text style={[styles.statusSubtitle, { color: colors.textSecondary }]}>
              Save your trips, expenses, chats, and receipts to your personal Google Drive account
            </Text>
          </View>
        </View>

        <View style={[styles.metaDivider, { backgroundColor: colors.borderLight }]} />

        {/* Last Backup Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {config.lastBackupDate || 'Never'}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Last Backup</Text>
          </View>

          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {config.lastBackupSizeBytes
                ? config.lastBackupSizeBytes < 1024 * 1024
                  ? `${(config.lastBackupSizeBytes / 1024).toFixed(1)} KB`
                  : `${(config.lastBackupSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                : '0 KB'}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Backup Size</Text>
          </View>

          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.text }]}>{trips.length}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Trips Ready</Text>
          </View>
        </View>

        {/* Primary BACK UP Button */}
        <TouchableOpacity
          style={[
            styles.backupBtn,
            { backgroundColor: '#25D366' },
            isBackingUp && { opacity: 0.7 },
          ]}
          onPress={handleStartBackup}
          disabled={isBackingUp}
          activeOpacity={0.8}
        >
          {isBackingUp ? (
            <>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.backupBtnText}>Backing Up to Google Drive...</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
              <Text style={styles.backupBtnText}>BACK UP</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Google Drive Settings Section */}
      <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>
        GOOGLE DRIVE SETTINGS
      </Text>

      <View
        style={[
          styles.settingsCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        {/* Google Account Row */}
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: colors.borderLight }]}
          onPress={() => {
            setGoogleEmailInput(config.email || user?.email || '');
            setAccountModalVisible(true);
          }}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
            <View>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Google Account</Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                {config.email ? config.email : 'Tap to connect your Google Account'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Auto Backup Frequency */}
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: colors.borderLight }]}
          onPress={() => setFreqModalVisible(true)}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <Ionicons name="time-outline" size={22} color="#F59E0B" />
            <View>
              <Text style={[styles.rowTitle, { color: colors.text }]}>
                Back up to Google Drive
              </Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                {config.frequency === 'daily'
                  ? 'Daily'
                  : config.frequency === 'weekly'
                  ? 'Weekly'
                  : "Only when I tap 'Back up'"}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Back Up Over Wi-Fi Only */}
        <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
          <View style={styles.rowLeft}>
            <Ionicons name="wifi-outline" size={22} color="#3B82F6" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Back up over</Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                {config.wifiOnly ? 'Wi-Fi only' : 'Wi-Fi or cellular data'}
              </Text>
            </View>
          </View>
          <Switch
            value={config.wifiOnly}
            onValueChange={async val => {
              const u = await saveGoogleDriveConfig({ wifiOnly: val });
              setConfig(u);
            }}
            trackColor={{ false: '#D1D5DB', true: colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Include Media & Receipts */}
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="images-outline" size={22} color="#A855F7" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>
                Include Media & Photos
              </Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                Preserves all bill photos, receipts & document attachments
              </Text>
            </View>
          </View>
          <Switch
            value={config.includeMedia}
            onValueChange={async val => {
              const u = await saveGoogleDriveConfig({ includeMedia: val });
              setConfig(u);
            }}
            trackColor={{ false: '#D1D5DB', true: '#25D366' }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      {/* Restore Section */}
      <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>
        RESTORE ON NEW DEVICE
      </Text>

      <View
        style={[
          styles.settingsCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.row}
          onPress={handleStartRestore}
          disabled={isRestoring}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <View
              style={[
                styles.smallIconCircle,
                { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : '#EFF6FF' },
              ]}
            >
              {isRestoring ? (
                <ActivityIndicator size="small" color="#3B82F6" />
              ) : (
                <Ionicons name="cloud-download-outline" size={20} color="#3B82F6" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: '#3B82F6' }]}>
                {isRestoring ? 'Restoring from Drive...' : 'Restore from Google Drive'}
              </Text>
              <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                Select a SplitYourTrip backup file from your Google Drive to restore on this device
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
        </TouchableOpacity>
      </View>

      {/* Export Specific Trips as Google Docs */}
      {trips.length > 0 && (
        <>
          <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>
            EXPORT TO GOOGLE DOCS
          </Text>

          <View
            style={[
              styles.settingsCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            {trips.slice(0, 5).map((t, idx) => (
              <View
                key={t.id}
                style={[
                  styles.tripExportRow,
                  idx < Math.min(trips.length, 5) - 1 && {
                    borderBottomColor: colors.borderLight,
                    borderBottomWidth: 1,
                  },
                ]}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.tripExportName, { color: colors.text }]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={[styles.tripExportMeta, { color: colors.textSecondary }]}>
                    {t.currency || 'INR'} • {t.trip_type === 'friend_split' ? 'Friend Split' : 'Group Trip'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.exportBtn, { borderColor: colors.primary }]}
                  onPress={() => handleExportTripDoc(t.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="document-text-outline" size={15} color={colors.primary} />
                  <Text style={[styles.exportBtnText, { color: colors.primary }]}>Google Doc</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Google Account Bottom Sheet */}
      <DraggableBottomSheet
        visible={accountModalVisible}
        onClose={() => setAccountModalVisible(false)}
        maxHeight="50%"
        sheetStyle={{ padding: 20 }}
      >
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Google Account for Backups</Text>
          <TouchableOpacity onPress={() => setAccountModalVisible(false)}>
            <Ionicons name="close-circle" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sheetDesc, { color: colors.textSecondary }]}>
          Enter your personal Google Account email address. Backups and Google Docs will be associated with this account.
        </Text>

        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          placeholder="e.g. yourname@gmail.com"
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          value={googleEmailInput}
          onChangeText={setGoogleEmailInput}
        />

        <TouchableOpacity
          style={[styles.sheetSaveBtn, { backgroundColor: '#25D366' }]}
          onPress={handleLinkAccount}
        >
          <Text style={styles.sheetSaveBtnText}>Save Google Account</Text>
        </TouchableOpacity>

        {config.email && (
          <TouchableOpacity
            style={[styles.sheetUnlinkBtn, { borderColor: colors.danger }]}
            onPress={handleDisconnect}
          >
            <Text style={[styles.sheetUnlinkBtnText, { color: colors.danger }]}>
              Unlink Account
            </Text>
          </TouchableOpacity>
        )}
      </DraggableBottomSheet>

      {/* Frequency Bottom Sheet */}
      <DraggableBottomSheet
        visible={freqModalVisible}
        onClose={() => setFreqModalVisible(false)}
        maxHeight="45%"
        sheetStyle={{ padding: 20 }}
      >
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Back up to Google Drive</Text>
          <TouchableOpacity onPress={() => setFreqModalVisible(false)}>
            <Ionicons name="close-circle" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {[
          { key: 'manual', label: "Only when I tap 'Back up'" },
          { key: 'daily', label: 'Daily' },
          { key: 'weekly', label: 'Weekly' },
        ].map(item => (
          <TouchableOpacity
            key={item.key}
            style={[styles.freqOptionRow, { borderBottomColor: colors.borderLight }]}
            onPress={async () => {
              const u = await saveGoogleDriveConfig({ frequency: item.key as any });
              setConfig(u);
              setFreqModalVisible(false);
            }}
          >
            <Text style={[styles.freqOptionLabel, { color: colors.text }]}>{item.label}</Text>
            {config.frequency === item.key && (
              <Ionicons name="checkmark-circle" size={20} color="#25D366" />
            )}
          </TouchableOpacity>
        ))}
      </DraggableBottomSheet>
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
  statusCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  statusSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  metaDivider: {
    height: 1,
    marginVertical: 14,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  backupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    gap: 8,
  },
  backupBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  settingsCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowSub: {
    fontSize: 12,
    marginTop: 2,
  },
  smallIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripExportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  tripExportName: {
    fontSize: 14,
    fontWeight: '700',
  },
  tripExportMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  exportBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  sheetDesc: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 16,
  },
  sheetSaveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
  },
  sheetSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  sheetUnlinkBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
  },
  sheetUnlinkBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  freqOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  freqOptionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
