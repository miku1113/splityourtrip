import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  Platform,
  Share,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTripStore } from '../../../src/features/trips/useTripStore';
import { useTheme } from '../../../src/theme/useThemeStore';
import {
  getFriendSettings,
  saveFriendSettings,
  FriendSettingsData,
} from '../../../src/services/friendSettings';

export default function FriendSettingsScreen() {
  const { id, friendName, friendPhone, friendId } = useLocalSearchParams<{
    id: string;
    friendName?: string;
    friendPhone?: string;
    friendId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { expenses, deleteTrip } = useTripStore();

  const settingsKey = friendId || id || '';
  const displayName = friendName || 'Friend';
  const displayPhone = friendPhone || '';

  const [nickname, setNickname] = useState('');
  const [notes, setNotes] = useState('');
  const [isBlocked, setIsBlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [defaultSplit, setDefaultSplit] = useState('equal');
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Calculate shared activity
  const friendExpenses = expenses.filter(e => e.trip_id === id);
  const totalAmountPaise = friendExpenses.reduce((sum, e) => sum + e.amount, 0);

  useEffect(() => {
    if (settingsKey) {
      getFriendSettings(settingsKey).then(data => {
        if (data.nickname) setNickname(data.nickname);
        if (data.notes) setNotes(data.notes);
        if (data.isBlocked !== undefined) setIsBlocked(data.isBlocked);
        if (data.isMuted !== undefined) setIsMuted(data.isMuted);
        if (data.defaultSplit) setDefaultSplit(data.defaultSplit);
      });
    }
  }, [settingsKey]);

  const handleToggleBlock = (val: boolean) => {
    if (val) {
      Alert.alert(
        'Block Friend',
        `Are you sure you want to block ${displayName}? You will not receive expense requests or new chat messages from this contact until unblocked.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block Contact',
            style: 'destructive',
            onPress: () => {
              setIsBlocked(true);
              saveFriendSettings(settingsKey, { isBlocked: true });
            },
          },
        ]
      );
    } else {
      setIsBlocked(false);
      saveFriendSettings(settingsKey, { isBlocked: false });
    }
  };

  const handleSave = async () => {
    if (!settingsKey || isSaving) return;
    setIsSaving(true);
    try {
      await saveFriendSettings(settingsKey, {
        nickname: nickname.trim(),
        notes: notes.trim(),
        isBlocked,
        isMuted,
        defaultSplit,
      });
      setSavedSuccess(true);
      Alert.alert('Saved', 'Friend preferences have been updated successfully.');
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save friend settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearChatHistory = () => {
    Alert.alert(
      'Clear Chat Messages',
      `Clear all messages for ${displayName}? Logged expenses and bill balances will remain intact.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Messages',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Cleared', 'Chat messages have been cleared for this conversation.');
          },
        },
      ]
    );
  };

  const handleExportSummary = async () => {
    const summary = `Split Summary with ${displayName} (${displayPhone}):\nTotal Expenses: ${friendExpenses.length}\nTotal Spent: ₹${(totalAmountPaise / 100).toFixed(2)}\nTracked via Split Your Trip.`;
    try {
      await Share.share({ message: summary });
    } catch {}
  };

  const handleDeleteSplit = () => {
    Alert.alert(
      'Remove Friend Conversation',
      `Are you sure you want to remove the split conversation with ${displayName}? All logged bills and chat history in this conversation will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Permanently',
          style: 'destructive',
          onPress: async () => {
            if (id) {
              await deleteTrip(id);
              Alert.alert('Conversation Removed', `Chat with ${displayName} has been removed.`);
              router.replace('/(tabs)/friends');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header Bar matching Chat & Info */}
      <View
        style={[
          styles.headerBar,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
            paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 6,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            Friend Settings
          </Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {nickname || displayName}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.headerSaveBtn, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.headerSaveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 140 }]}
          automaticallyAdjustKeyboardInsets={true}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
        {/* Contact Info Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.profileHeaderRow}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>
                {(nickname || displayName || 'F').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.contactName, { color: colors.text }]}>
                {nickname || displayName}
              </Text>
              {displayPhone ? (
                <Text style={[styles.contactPhone, { color: colors.textSecondary }]}>
                  {displayPhone}
                </Text>
              ) : null}
              <View style={styles.badgeRow}>
                {isBlocked ? (
                  <View style={[styles.statusBadge, { backgroundColor: colors.dangerBg }]}>
                    <Text style={[styles.statusBadgeText, { color: colors.danger }]}>Blocked</Text>
                  </View>
                ) : (
                  <View style={[styles.statusBadge, { backgroundColor: colors.successBg }]}>
                    <Text style={[styles.statusBadgeText, { color: colors.success }]}>Active</Text>
                  </View>
                )}
                {isMuted && (
                  <View style={[styles.statusBadge, { backgroundColor: colors.borderLight }]}>
                    <Text style={[styles.statusBadgeText, { color: colors.textSecondary }]}>
                      Muted
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Customization Details */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Contact Customization</Text>

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Custom Nickname</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={nickname}
            onChangeText={setNickname}
            placeholder={`e.g. ${displayName} (College)`}
            placeholderTextColor={colors.textMuted}
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Friend Notes</Text>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Add personal reminders, UPI details, or notes..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={2}
          />
        </View>

        {/* Privacy & Notification Settings */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Controls & Privacy</Text>

          {/* Block Toggle */}
          <View style={[styles.switchRow, { borderBottomColor: colors.borderLight }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <View style={styles.switchTitleRow}>
                <Ionicons
                  name="ban-outline"
                  size={18}
                  color={isBlocked ? colors.danger : colors.text}
                />
                <Text
                  style={[
                    styles.switchTitle,
                    { color: isBlocked ? colors.danger : colors.text },
                  ]}
                >
                  Block Friend
                </Text>
              </View>
              <Text style={[styles.switchSub, { color: colors.textSecondary }]}>
                Prevent sending or receiving split bills and messages with this friend.
              </Text>
            </View>
            <Switch
              value={isBlocked}
              onValueChange={handleToggleBlock}
              trackColor={{ false: colors.border, true: colors.danger }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* Mute Notifications Toggle */}
          <View style={[styles.switchRow, { borderBottomColor: colors.borderLight }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <View style={styles.switchTitleRow}>
                <Ionicons name="notifications-off-outline" size={18} color={colors.text} />
                <Text style={[styles.switchTitle, { color: colors.text }]}>Mute Alerts</Text>
              </View>
              <Text style={[styles.switchSub, { color: colors.textSecondary }]}>
                Silence notifications for new messages and bills in this split.
              </Text>
            </View>
            <Switch
              value={isMuted}
              onValueChange={setIsMuted}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* Default Split Preference */}
          <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 12 }]}>
            Default Split Preference
          </Text>
          <View style={styles.splitSegmentRow}>
            {[
              { id: 'equal', label: '50/50 Equal' },
              { id: 'you_paid', label: 'You Paid All' },
              { id: 'they_paid', label: 'They Paid All' },
            ].map(item => {
              const isSelected = defaultSplit === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.splitSegmentBtn,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.inputBackground,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setDefaultSplit(item.id)}
                >
                  <Text
                    style={[
                      styles.splitSegmentText,
                      { color: isSelected ? '#FFFFFF' : colors.textSecondary },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Financial Overview & Actions */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Activity & Tools</Text>

          <View style={[styles.statRow, { backgroundColor: colors.inputBackground }]}>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {friendExpenses.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Expenses</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                ₹{(totalAmountPaise / 100).toFixed(0)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Total Shared</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.actionRowBtn, { borderColor: colors.border }]}
            onPress={handleExportSummary}
          >
            <Ionicons name="share-outline" size={18} color={colors.primary} />
            <Text style={[styles.actionRowText, { color: colors.primary }]}>
              Export / Share Split Summary
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRowBtn, { borderColor: colors.border }]}
            onPress={handleClearChatHistory}
          >
            <Ionicons name="chatbubbles-outline" size={18} color={colors.warning} />
            <Text style={[styles.actionRowText, { color: colors.warning }]}>
              Clear Chat History
            </Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.danger,
              borderWidth: 1,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.danger }]}>Danger Zone</Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
            Remove this 1-on-1 split and all associated expense history permanently.
          </Text>

          <TouchableOpacity
            style={[styles.deleteBtn, { backgroundColor: colors.dangerBg }]}
            onPress={handleDeleteSplit}
          >
            <View style={styles.btnRow}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.deleteBtnText, { color: colors.danger }]}>
                Remove Friend Split
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Bottom Save Action */}
        <TouchableOpacity
          style={[
            styles.mainSaveBtn,
            { backgroundColor: savedSuccess ? colors.success : colors.primary },
            isSaving && { opacity: 0.75 },
          ]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <View style={styles.btnRow}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.mainSaveBtnText}>Saving changes...</Text>
            </View>
          ) : savedSuccess ? (
            <View style={styles.btnRow}>
              <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              <Text style={styles.mainSaveBtnText}>Settings Saved!</Text>
            </View>
          ) : (
            <View style={styles.btnRow}>
              <Ionicons name="save-outline" size={18} color="#FFFFFF" />
              <Text style={styles.mainSaveBtnText}>Save Friend Settings</Text>
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  headerSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  headerSaveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  content: {
    padding: 16,
    paddingBottom: 72,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  contactName: {
    fontSize: 18,
    fontWeight: '700',
  },
  contactPhone: {
    fontSize: 13,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 13,
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: {
    height: 64,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  switchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  switchTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  switchSub: {
    fontSize: 12,
    lineHeight: 16,
  },
  splitSegmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  splitSegmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
  },
  splitSegmentText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statRow: {
    flexDirection: 'row',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
  },
  actionRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  actionRowText: {
    fontSize: 14,
    fontWeight: '600',
  },
  deleteBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  deleteBtnText: {
    fontWeight: '700',
    fontSize: 14,
  },
  mainSaveBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 30,
  },
  mainSaveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
