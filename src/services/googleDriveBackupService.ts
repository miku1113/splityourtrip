import { Platform, Share, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { AppStorage } from '../lib/storage';
import { useTripStore, Trip, TripMember, Expense } from '../features/trips/useTripStore';
import { TripMessage } from '../types/database';
import { useAuthStore } from '../features/auth/useAuthStore';
import { formatCurrencyAmount } from './currency';

export interface GoogleDriveConfig {
  email: string | null;
  name: string | null;
  isConnected: boolean;
  accessToken: string | null;
  lastBackupDate: string | null;
  lastBackupSizeBytes: number | null;
  includeMedia: boolean;
  wifiOnly: boolean;
  frequency: 'manual' | 'daily' | 'weekly';
}

export interface BackupTripData {
  trip: Trip;
  members: TripMember[];
  expenses: any[];
  messages: TripMessage[];
}

export interface BackupPayload {
  app: 'SplitYourTrip';
  version: string;
  exportedAt: string;
  user: {
    id?: string;
    email?: string | null;
    name?: string | null;
  };
  trips: BackupTripData[];
  metadata: {
    totalTrips: number;
    totalExpenses: number;
    totalMessages: number;
    totalMembers: number;
  };
}

const CONFIG_KEY = '@splityourtrip_gdrive_config';

/**
 * Retrieve saved Google Drive Backup configuration.
 */
export async function getGoogleDriveConfig(): Promise<GoogleDriveConfig> {
  try {
    const raw = await AppStorage.getItem(CONFIG_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[GoogleDrive] Error reading config:', err);
  }
  return {
    email: null,
    name: null,
    isConnected: false,
    accessToken: null,
    lastBackupDate: null,
    lastBackupSizeBytes: null,
    includeMedia: true,
    wifiOnly: false,
    frequency: 'manual',
  };
}

/**
 * Save Google Drive Backup configuration updates.
 */
export async function saveGoogleDriveConfig(
  updates: Partial<GoogleDriveConfig>
): Promise<GoogleDriveConfig> {
  const current = await getGoogleDriveConfig();
  const next: GoogleDriveConfig = { ...current, ...updates };
  await AppStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

/**
 * Connect or update a user's Google account for Google Drive backups.
 */
export async function linkGoogleDriveAccount(
  email: string,
  name?: string | null,
  accessToken?: string | null
): Promise<GoogleDriveConfig> {
  return await saveGoogleDriveConfig({
    email,
    name: name || email.split('@')[0],
    isConnected: true,
    accessToken: accessToken || null,
  });
}

/**
 * Disconnect Google Drive account.
 */
export async function unlinkGoogleDriveAccount(): Promise<GoogleDriveConfig> {
  return await saveGoogleDriveConfig({
    email: null,
    name: null,
    isConnected: false,
    accessToken: null,
  });
}

/**
 * Compiles all user trip data, expenses, splits, attachments, and chat history into a structured backup payload.
 */
export async function generateBackupPayload(): Promise<BackupPayload> {
  const tripStore = useTripStore.getState();
  const authStore = useAuthStore.getState();

  const userTrips = tripStore.trips || [];
  const backupTrips: BackupTripData[] = [];

  let totalExpenses = 0;
  let totalMessages = 0;
  let totalMembers = 0;

  for (const t of userTrips) {
    let members: TripMember[] = [];
    let expenses: any[] = [];
    let messages: TripMessage[] = [];

    // Attempt to load full local cached details
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        members = parsed.members || [];
        expenses = parsed.expenses || [];
        messages = parsed.messages || [];
      }
    } catch {}

    // Fallback if currently active trip in store
    if (tripStore.activeTrip?.id === t.id) {
      if (members.length === 0 && tripStore.members.length > 0) {
        members = tripStore.members;
      }
      if (expenses.length === 0 && tripStore.expenses.length > 0) {
        expenses = tripStore.expenses;
      }
      if (messages.length === 0 && tripStore.messages.length > 0) {
        messages = tripStore.messages;
      }
    }

    totalExpenses += expenses.length;
    totalMessages += messages.length;
    totalMembers += members.length;

    backupTrips.push({
      trip: t,
      members,
      expenses,
      messages,
    });
  }

  const payload: BackupPayload = {
    app: 'SplitYourTrip',
    version: '1.0.39',
    exportedAt: new Date().toISOString(),
    user: {
      id: authStore.user?.id || authStore.profile?.id,
      email: authStore.user?.email || null,
      name: authStore.profile?.full_name || authStore.profile?.name || null,
    },
    trips: backupTrips,
    metadata: {
      totalTrips: userTrips.length,
      totalExpenses,
      totalMessages,
      totalMembers,
    },
  };

  return payload;
}

/**
 * Generates a human-readable HTML Trip Report that can be opened directly in Google Docs or any web browser.
 */
export function generateReadableTripSummary(tripData: BackupTripData): string {
  const { trip, members, expenses, messages } = tripData;
  const currency = trip.currency || 'INR';

  const totalPaise = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalFormatted = formatCurrencyAmount(totalPaise, currency);

  const memberRows = members
    .map(
      m => `<tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${m.display_name || 'Member'}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${m.phone_number || '-'}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;"><span style="background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 9999px; font-size: 12px;">${m.role}</span></td>
      </tr>`
    )
    .join('');

  const expenseRows = expenses
    .map(e => {
      const amtStr = formatCurrencyAmount(e.amount || 0, e.currency || currency);
      const dateStr = e.expense_date || e.created_at ? new Date(e.expense_date || e.created_at).toLocaleDateString() : '-';
      const payer = members.find(m => m.id === e.paid_by || m.profile_id === e.paid_by)?.display_name || 'Someone';
      const attachmentLink = e.attachment_url
        ? `<br/><a href="${e.attachment_url}" target="_blank" style="color: #6366f1; font-size: 12px;">📎 View Receipt</a>`
        : '';
      return `<tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;"><b>${e.description}</b>${attachmentLink}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #0f172a;">${amtStr}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #475569;">${payer}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px;">${e.category || 'General'}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px;">${dateStr}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${trip.name} - SplitYourTrip Summary</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1e293b; background: #ffffff; padding: 24px; max-width: 900px; margin: 0 auto; }
    .header { border-bottom: 3px solid #6366f1; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 28px; font-weight: 800; color: #0f172a; margin: 0 0 6px 0; }
    .meta { font-size: 14px; color: #64748b; margin: 0; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 24px; display: flex; gap: 32px; }
    .stat-val { font-size: 24px; font-weight: 800; color: #4338ca; }
    .stat-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 28px; }
    th { text-align: left; padding: 10px 12px; background: #f1f5f9; color: #475569; font-size: 13px; font-weight: 700; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
    .section-title { font-size: 18px; font-weight: 700; color: #1e293b; margin-top: 24px; margin-bottom: 8px; }
    .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="title">✈️ ${trip.name}</h1>
    <p class="meta">SplitYourTrip Google Drive Report • Exported on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
  </div>

  <div class="stat-card">
    <div>
      <div class="stat-val">${totalFormatted}</div>
      <div class="stat-lbl">Total Expenses</div>
    </div>
    <div>
      <div class="stat-val">${expenses.length}</div>
      <div class="stat-lbl">Transactions</div>
    </div>
    <div>
      <div class="stat-val">${members.length}</div>
      <div class="stat-lbl">Members</div>
    </div>
  </div>

  <h2 class="section-title">Trip Members</h2>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Phone</th>
        <th>Role</th>
      </tr>
    </thead>
    <tbody>
      ${memberRows || '<tr><td colspan="3" style="padding: 12px; text-align: center; color: #94a3b8;">No members recorded</td></tr>'}
    </tbody>
  </table>

  <h2 class="section-title">Expense Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Amount</th>
        <th>Paid By</th>
        <th>Category</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>
      ${expenseRows || '<tr><td colspan="5" style="padding: 12px; text-align: center; color: #94a3b8;">No expenses recorded</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    Generated by <b>Split Your Trip</b> • Secure Google Drive Backup & Cloud Synchronization
  </div>
</body>
</html>`;
}

/**
 * Uploads a file directly to Google Drive via Google Drive REST API v3.
 * Creates 'SplitYourTrip Backups' folder in user's Drive if it does not exist.
 */
async function uploadToGoogleDriveAPI(
  accessToken: string,
  fileName: string,
  mimeType: string,
  content: string
): Promise<{ fileId: string; folderId: string }> {
  // 1. Locate or create 'SplitYourTrip Backups' folder
  const listFolderRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='SplitYourTrip Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  let folderId = '';
  if (listFolderRes.ok) {
    const listData = await listFolderRes.json();
    if (listData.files && listData.files.length > 0) {
      folderId = listData.files[0].id;
    }
  }

  if (!folderId) {
    const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'SplitYourTrip Backups',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!createFolderRes.ok) {
      throw new Error('Failed to create SplitYourTrip Backups folder in Google Drive.');
    }
    const folderData = await createFolderRes.json();
    folderId = folderData.id;
  }

  // 2. Upload multipart file with parent folder
  const boundary = '-------SplitYourTripUploadBoundary' + Math.random().toString(36).substring(2);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType: mimeType,
    parents: [folderId],
  };

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Google Drive API upload failed: ${errText}`);
  }

  const uploadedData = await uploadRes.json();
  return { fileId: uploadedData.id, folderId };
}

/**
 * Performs WhatsApp-style Google Drive backup.
 * 1. Checks if Google Drive OAuth token is active -> uploads via Drive API.
 * 2. Also writes file to cache and offers native system "Save to Google Drive" share option.
 */
export async function performGoogleDriveBackup(options?: {
  interactive?: boolean;
}): Promise<{
  success: boolean;
  fileName: string;
  fileSizeBytes: number;
  formattedSize: string;
  timestamp: string;
  fileUri: string;
}> {
  const config = await getGoogleDriveConfig();
  const payload = await generateBackupPayload();

  const now = new Date();
  const dateTag = now.toISOString().split('T')[0];
  const timeTag = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const fileName = `SplitYourTrip_Backup_${dateTag}_${timeTag}.json`;

  const jsonString = JSON.stringify(payload, null, 2);
  const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  const fileUri = `${cacheDir}${fileName}`;

  // Write file to device storage
  await FileSystem.writeAsStringAsync(fileUri, jsonString, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  const sizeBytes = fileInfo.exists && (fileInfo as any).size ? (fileInfo as any).size : jsonString.length;
  const formattedSize =
    sizeBytes < 1024
      ? `${sizeBytes} B`
      : sizeBytes < 1024 * 1024
      ? `${(sizeBytes / 1024).toFixed(1)} KB`
      : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;

  let uploadedViaAPI = false;

  // Try direct Google Drive REST API if user has connected token with Drive scope
  if (config.accessToken) {
    try {
      await uploadToGoogleDriveAPI(
        config.accessToken,
        fileName,
        'application/json',
        jsonString
      );
      uploadedViaAPI = true;
    } catch (apiErr) {
      console.warn('[GoogleDrive] Direct API upload notice:', apiErr);
    }
  }

  // Update backup history in local config
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const displayDate = `Today at ${timeStr}`;

  await saveGoogleDriveConfig({
    lastBackupDate: displayDate,
    lastBackupSizeBytes: sizeBytes,
  });

  // If running in interactive mode, trigger native system sheet with "Save to Drive" option
  if (options?.interactive !== false) {
    try {
      let shareUri = fileUri;
      if (Platform.OS === 'android') {
        try {
          shareUri = await FileSystem.getContentUriAsync(fileUri);
        } catch {
          shareUri = fileUri;
        }
      }

      await Share.share({
        title: 'SplitYourTrip Google Drive Backup',
        message: `SplitYourTrip Backup file (${formattedSize}). Select 'Save to Drive' to store in your personal Google Drive.`,
        url: shareUri,
      });
    } catch (shareErr) {
      console.log('[GoogleDrive] Share sheet closed or cancelled:', shareErr);
    }
  }

  return {
    success: true,
    fileName,
    fileSizeBytes: sizeBytes,
    formattedSize,
    timestamp: displayDate,
    fileUri,
  };
}

/**
 * Restores data from a user-selected Google Drive backup file.
 * Opens system Document Picker allowing user to pick directly from their Google Drive folder.
 */
export async function restoreFromGoogleDrivePicker(): Promise<{
  success: boolean;
  tripsRestored: number;
  expensesRestored: number;
  messagesRestored: number;
}> {
  // Prompt user to pick their backup file from Google Drive / Files
  const pickResult = await DocumentPicker.getDocumentAsync({
    type: ['application/json', '*/*'],
    copyToCacheDirectory: true,
  });

  if (pickResult.canceled || !pickResult.assets || pickResult.assets.length === 0) {
    return { success: false, tripsRestored: 0, expensesRestored: 0, messagesRestored: 0 };
  }

  const asset = pickResult.assets[0];
  const fileContent = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  let parsed: BackupPayload;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err) {
    throw new Error('Selected file is not a valid JSON document.');
  }

  if (parsed.app !== 'SplitYourTrip' || !Array.isArray(parsed.trips)) {
    throw new Error('Selected file is not a valid SplitYourTrip backup archive.');
  }

  const tripStore = useTripStore.getState();
  const existingTrips = tripStore.trips || [];
  const existingTripIds = new Set(existingTrips.map(t => t.id));

  let tripsRestored = 0;
  let expensesRestored = 0;
  let messagesRestored = 0;

  const mergedTrips = [...existingTrips];

  for (const bTrip of parsed.trips) {
    const tripObj = bTrip.trip;
    if (!tripObj || !tripObj.id) continue;

    // Save individual trip cached details to AppStorage
    const details = {
      members: bTrip.members || [],
      expenses: bTrip.expenses || [],
      messages: bTrip.messages || [],
    };

    await AppStorage.setItem(
      `@splityourtrip_local_details_${tripObj.id}`,
      JSON.stringify(details)
    );

    expensesRestored += details.expenses.length;
    messagesRestored += details.messages.length;

    if (!existingTripIds.has(tripObj.id)) {
      mergedTrips.push(tripObj);
      tripsRestored++;
    }
  }

  // Update trip store state
  useTripStore.setState({
    trips: mergedTrips,
  });

  // Persist updated trips list
  const authUserId = useAuthStore.getState().user?.id;
  await AppStorage.setItem(
    `@splityourtrip_trips_${authUserId || 'guest'}`,
    JSON.stringify(mergedTrips)
  );

  return {
    success: true,
    tripsRestored: tripsRestored > 0 ? tripsRestored : parsed.trips.length,
    expensesRestored,
    messagesRestored,
  };
}

/**
 * Exports a specific trip as a clean Google Doc / HTML document.
 */
export async function exportTripToGoogleDoc(tripId: string): Promise<string> {
  const tripStore = useTripStore.getState();
  const trip = tripStore.trips.find(t => t.id === tripId) || tripStore.activeTrip;
  if (!trip) throw new Error('Trip not found.');

  let members = tripStore.members;
  let expenses = tripStore.expenses;
  let messages = tripStore.messages;

  try {
    const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.members) members = parsed.members;
      if (parsed.expenses) expenses = parsed.expenses;
      if (parsed.messages) messages = parsed.messages;
    }
  } catch {}

  const html = generateReadableTripSummary({
    trip,
    members,
    expenses,
    messages,
  });

  const safeName = trip.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Trip_Report_${safeName}.html`;
  const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  const fileUri = `${cacheDir}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  let shareUri = fileUri;
  if (Platform.OS === 'android') {
    try {
      shareUri = await FileSystem.getContentUriAsync(fileUri);
    } catch {
      shareUri = fileUri;
    }
  }

  await Share.share({
    title: `${trip.name} - Google Doc Report`,
    message: `Trip report for ${trip.name}. Save to Google Drive to open as a Google Doc.`,
    url: shareUri,
  });

  return fileUri;
}
