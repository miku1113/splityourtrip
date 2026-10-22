import { AppState, Platform } from 'react-native';
import { AppStorage } from '../lib/storage';
import { supabase, supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import {
  uploadImageToSupabase,
  uploadAudioToSupabase,
  uploadDocumentToSupabase,
  uploadVideoToSupabase,
} from './imageUpload';

export interface OutboxMediaData {
  type: 'image' | 'video' | 'document' | 'audio';
  localUri?: string;
  remoteUrl?: string;
  name?: string;
  size?: string;
  duration?: number;
  base64?: string;
}

export interface OutboxMessageItem {
  id: string; // Message UUID
  tripId: string;
  senderId: string;
  senderName: string;
  text: string;
  type:
    | 'text'
    | 'image'
    | 'video'
    | 'document'
    | 'audio'
    | 'expense'
    | 'dispute'
    | 'system'
    | 'payment_claim'
    | 'payment_settlement'
    | 'payment_request';
  chatType: 'group' | 'individual';
  mediaData?: OutboxMediaData;
  payload?: any;
  status: 'queued' | 'uploading' | 'sending' | 'sent' | 'failed';
  createdAt: string;
  retryCount: number;
  lastAttemptAt?: string;
  errorMessage?: string;
}

const OUTBOX_STORAGE_KEY = '@splityourtrip_chat_outbox_queue_v1';
const SUPABASE_BASE_URL = 'https://hpjizujbzvwkxvfsoqqd.supabase.co';

type OutboxChangeListener = (queue: OutboxMessageItem[]) => void;
type MessageSentCallback = (
  messageId: string,
  tripId: string,
  remoteUrl?: string,
  duration?: number
) => void;

class ChatOutboxManager {
  private queue: OutboxMessageItem[] = [];
  private isProcessing = false;
  private changeListeners: Set<OutboxChangeListener> = new Set();
  private sentCallbacks: Set<MessageSentCallback> = new Set();
  private retryTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    await this.loadQueue();

    // Re-check queue whenever app returns to foreground
    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', state => {
        if (state === 'active') {
          this.processQueue();
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.processQueue();
      });
    }

    // If there were leftover items from previous session, process them
    if (this.queue.length > 0) {
      this.ensureRetryHeartbeat();
      this.processQueue();
    }
  }

  /**
   * Fast, reliable connectivity check against Supabase
   */
  public async isOnline(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
      return false;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${SUPABASE_BASE_URL}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          apikey: 'anon',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.status >= 200 && res.status < 500;
    } catch {
      return false;
    }
  }

  private async loadQueue() {
    try {
      const raw = await AppStorage.getItem(OUTBOX_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.queue = parsed;
          this.notifyListeners();
        }
      }
    } catch (e) {
      console.warn('Failed to load chat outbox queue:', e);
    }
  }

  private async saveQueue() {
    try {
      await AppStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(this.queue));
      this.notifyListeners();
    } catch (e) {
      console.warn('Failed to save chat outbox queue:', e);
    }
  }

  private notifyListeners() {
    const copy = [...this.queue];
    this.changeListeners.forEach(listener => {
      try {
        listener(copy);
      } catch (err) {
        console.warn('Outbox listener error:', err);
      }
    });
  }

  public subscribe(listener: OutboxChangeListener): () => void {
    this.changeListeners.add(listener);
    listener([...this.queue]);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  public onMessageSent(callback: MessageSentCallback): () => void {
    this.sentCallbacks.add(callback);
    return () => {
      this.sentCallbacks.delete(callback);
    };
  }

  public getQueue(): OutboxMessageItem[] {
    return [...this.queue];
  }

  public getPendingForTrip(tripId: string): OutboxMessageItem[] {
    return this.queue.filter(item => !item.tripId || item.tripId === tripId);
  }

  public getItem(messageId: string): OutboxMessageItem | undefined {
    return this.queue.find(item => item.id === messageId);
  }

  /**
   * Adds an outgoing message to the persistent outbox and triggers immediate queue processing
   */
  public async enqueue(item: OutboxMessageItem): Promise<void> {
    const existingIndex = this.queue.findIndex(i => i.id === item.id);
    if (existingIndex >= 0) {
      this.queue[existingIndex] = { ...this.queue[existingIndex], ...item };
    } else {
      this.queue.push(item);
    }
    await this.saveQueue();
    this.ensureRetryHeartbeat();
    this.processQueue();
  }

  /**
   * Removes a sent or cancelled message from the outbox
   */
  public async remove(messageId: string): Promise<void> {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter(i => i.id !== messageId);
    if (this.queue.length !== initialLen) {
      await this.saveQueue();
    }
    if (this.queue.length === 0) {
      this.stopRetryHeartbeat();
    }
  }

  private ensureRetryHeartbeat() {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.processQueue();
      } else {
        this.stopRetryHeartbeat();
      }
    }, 4000);
  }

  private stopRetryHeartbeat() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Process all queued items sequentially in FIFO order.
   * If network drops or upload/send encounters network errors,
   * items remain in 'queued' status and will be retried automatically.
   */
  public async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      // Sort oldest first
      const sortedQueue = [...this.queue].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      for (const item of sortedQueue) {
        // Find fresh state in queue
        const currentItem = this.queue.find(i => i.id === item.id);
        if (!currentItem || currentItem.status === 'sent') continue;

        currentItem.lastAttemptAt = new Date().toISOString();

        // 1. Upload media if present and not yet uploaded
        if (currentItem.mediaData?.localUri && !currentItem.mediaData.remoteUrl) {
          currentItem.status = 'uploading';
          this.notifyListeners();

          try {
            let uploadedUrl: string | null = null;
            const { type, localUri, name } = currentItem.mediaData;

            if (type === 'image') {
              const storagePath = `chat/${currentItem.tripId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
              uploadedUrl = await uploadImageToSupabase('attachments', storagePath, localUri);
            } else if (type === 'video') {
              uploadedUrl = await uploadVideoToSupabase(currentItem.tripId, localUri, name);
            } else if (type === 'document') {
              uploadedUrl = await uploadDocumentToSupabase(currentItem.tripId, localUri, name);
            } else if (type === 'audio') {
              uploadedUrl = await uploadAudioToSupabase(currentItem.tripId, localUri);
            }

            if (uploadedUrl) {
              currentItem.mediaData.remoteUrl = uploadedUrl;
              await this.saveQueue();
            } else {
              // Upload returned null or failed due to network
              currentItem.status = 'queued';
              currentItem.retryCount = (currentItem.retryCount || 0) + 1;
              await this.saveQueue();
              // Back off on network failure to avoid hammer
              break;
            }
          } catch (uploadErr: any) {
            console.warn(`[Outbox] Media upload error for ${currentItem.id}:`, uploadErr?.message);
            currentItem.status = 'queued';
            currentItem.retryCount = (currentItem.retryCount || 0) + 1;
            currentItem.errorMessage = uploadErr?.message || 'Network upload error';
            await this.saveQueue();
            // Stop and retry later on network recovery
            break;
          }
        }

        // If message has media, require remoteUrl before committing to remote database
        if (currentItem.mediaData && !currentItem.mediaData.remoteUrl) {
          // Media has not finished cloud upload yet. Keep in queued status and retry when network is available.
          currentItem.status = 'queued';
          await this.saveQueue();
          break;
        }

        try {
          const client = supabaseAdmin || supabase;
          const remoteMediaUrl = currentItem.mediaData?.remoteUrl;

          // Build database payload string
          let fullPayload = currentItem.text.trim();
          if (currentItem.mediaData) {
            fullPayload = JSON.stringify({
              type: currentItem.mediaData.type,
              text: currentItem.text.trim() || (
                currentItem.mediaData.type === 'image'
                  ? '📷 Photo'
                  : currentItem.mediaData.type === 'video'
                  ? '🎥 Video'
                  : currentItem.mediaData.type === 'audio'
                  ? '🎤 Voice note'
                  : '📄 Document'
              ),
              chat_type: currentItem.chatType,
              media_url: remoteMediaUrl,
              media_name: currentItem.mediaData.name,
              media_size: currentItem.mediaData.size,
              duration: currentItem.mediaData.duration,
              is_sent: true,
              is_seen: false,
            });
          } else if (currentItem.payload) {
            const p = { ...currentItem.payload, is_sent: true, is_seen: false };
            fullPayload = JSON.stringify(p);
          }

          if (isSupabaseConfigured) {
            // Attempt insert into trip_messages
            const { error: insertErr } = await client.from('trip_messages').insert({
              id: currentItem.id,
              trip_id: currentItem.tripId,
              sender_id: currentItem.senderId && currentItem.senderId !== 'local_user' ? currentItem.senderId : null,
              sender_name: currentItem.senderName,
              message: fullPayload,
              created_at: currentItem.createdAt,
            });

            if (insertErr) {
              const isNetworkError =
                insertErr.message?.includes('Network') ||
                insertErr.message?.includes('Failed to fetch') ||
                insertErr.message?.includes('timeout') ||
                insertErr.message?.includes('connection');

              if (isNetworkError) {
                console.warn('[Outbox] Database insert network error, waiting in queue:', insertErr.message);
                currentItem.status = 'queued';
                currentItem.retryCount = (currentItem.retryCount || 0) + 1;
                await this.saveQueue();
                break;
              } else {
                console.warn('[Outbox] trip_messages insert fallback:', insertErr.message);
              }
            }

            // Also insert into messages table if applicable
            try {
              const dbMsgType = currentItem.type === 'expense' ? 'expense' : (currentItem.type === 'image' ? 'image' : 'text');
              await client.from('messages').insert({
                id: currentItem.id,
                trip_id: currentItem.tripId,
                sender_id: currentItem.senderId && currentItem.senderId !== 'local_user' ? currentItem.senderId : null,
                content: fullPayload,
                message_type: dbMsgType,
                metadata: {
                  chat_type: currentItem.chatType,
                  is_group: currentItem.chatType === 'group',
                },
              });
            } catch {}

            // Send push notification
            try {
              const { sendPushNotificationToMembers } = require('./pushNotificationService');
              sendPushNotificationToMembers(
                currentItem.tripId,
                currentItem.senderId,
                currentItem.senderName,
                currentItem.text,
                { type: currentItem.type, messageId: currentItem.id }
              ).catch(() => {});
            } catch {}
          }

          // 3. Success! Mark sent and remove from outbox
          currentItem.status = 'sent';
          this.sentCallbacks.forEach(cb => {
            try {
              cb(
                currentItem.id,
                currentItem.tripId,
                remoteMediaUrl,
                currentItem.mediaData?.duration
              );
            } catch (cbErr) {
              console.warn('[Outbox] Sent callback error:', cbErr);
            }
          });

          await this.remove(currentItem.id);
        } catch (dbErr: any) {
          console.warn(`[Outbox] Cloud insert error for ${currentItem.id}:`, dbErr?.message);
          currentItem.status = 'queued';
          currentItem.retryCount = (currentItem.retryCount || 0) + 1;
          currentItem.errorMessage = dbErr?.message || 'Database connection error';
          await this.saveQueue();
          // Pause queue processing until internet is restored
          break;
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length === 0) {
        this.stopRetryHeartbeat();
      }
    }
  }

  /**
   * Manually trigger immediate retry for a specific queued item or the whole queue
   */
  public retryNow(messageId?: string): void {
    if (messageId) {
      const item = this.queue.find(i => i.id === messageId);
      if (item) {
        item.status = 'queued';
        item.retryCount = 0;
        this.saveQueue();
      }
    }
    this.ensureRetryHeartbeat();
    this.processQueue();
  }
}

export const chatOutbox = new ChatOutboxManager();
