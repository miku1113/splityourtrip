import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Animated,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { extractPaymentFromScreenshot } from '../services/receiptOcr';
import { useTheme } from '../theme/useThemeStore';
import { moderateScale, scaleFont } from '../theme/responsive';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCAN_FRAME_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 330);
const SCAN_FRAME_HEIGHT = Math.min(SCREEN_WIDTH * 1.05, 420);

export interface ScannedBillResult {
  amount: string;
  description: string;
  category: string;
  paymentMode: 'upi' | 'cash' | 'other';
  upiTxnId: string;
  detectedApp: string;
  imageUri: string;
}

interface BillScannerModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * If provided (e.g. inside an existing trip or friend expense screen),
   * the scanned result is returned directly to this callback.
   * If NOT provided (global modal flow), it automatically navigates to /shared-payment
   * where the user can pick between trips and friends!
   */
  onScanComplete?: (result: ScannedBillResult) => void;
}

export default function BillScannerModal({
  visible,
  onClose,
  onScanComplete,
}: BillScannerModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [isTorchOn, setIsTorchOn] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('Analyzing receipt...');
  const [qrProcessed, setQrProcessed] = useState(false);

  // Animated laser line inside the scanner frame
  const laserAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setQrProcessed(false);
      // Auto-request camera permission if not granted
      if (!permission?.granted) {
        requestPermission().catch(() => {});
      }

      // Start continuous scanning laser animation
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(laserAnim, {
            toValue: SCAN_FRAME_HEIGHT - 6,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(laserAnim, {
            toValue: 6,
            duration: 1800,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      setIsTorchOn(false);
      setIsProcessing(false);
    }
  }, [visible, permission?.granted]);

  // Process the captured or selected image URI through AI OCR
  const processImageUri = async (uri: string) => {
    try {
      setIsProcessing(true);
      setProcessingStatus('✨ AI Reading Bill / Payment...');

      const { parsed } = await extractPaymentFromScreenshot(uri);

      let amountStr = '';
      if (parsed.amountPaise) {
        const rupees = parsed.amountPaise / 100;
        amountStr = rupees % 1 === 0 ? rupees.toString() : rupees.toFixed(2);
      }

      let desc = '';
      if (parsed.receiverName) {
        desc = parsed.app !== 'unknown' ? `Payment to ${parsed.receiverName}` : parsed.receiverName;
      } else if (parsed.billNumber) {
        desc = `Bill #${parsed.billNumber}`;
      } else if (parsed.app !== 'unknown') {
        desc = `Payment via ${parsed.app.toUpperCase()}`;
      } else {
        desc = 'Scanned Expense';
      }

      const result: ScannedBillResult = {
        amount: amountStr,
        description: desc,
        category: parsed.suggestedCategory || 'Food',
        paymentMode: parsed.app !== 'unknown' ? 'upi' : 'cash',
        upiTxnId: parsed.upiTxnId || '',
        detectedApp: parsed.app || 'unknown',
        imageUri: uri,
      };

      if (onScanComplete) {
        // Direct mode: return to caller screen (e.g. Add Expense screen)
        onScanComplete(result);
        onClose();
      } else {
        // Global mode: Close scanner and navigate to /shared-payment with pre-extracted data
        onClose();
        setTimeout(() => {
          router.push({
            pathname: '/shared-payment',
            params: {
              imageUri: uri,
              amount: result.amount,
              description: result.description,
              category: result.category,
              receiverName: parsed.receiverName || '',
              detectedApp: result.detectedApp,
              upiTxnId: result.upiTxnId,
            },
          });
        }, 120);
      }
    } catch (e: any) {
      console.log('Error scanning image:', e);
      Alert.alert(
        'Scan Notice',
        'Image captured, but text was not clearly detected. You can still adjust details in the form.',
        [
          {
            text: 'Continue',
            onPress: () => {
              const fallbackResult: ScannedBillResult = {
                amount: '',
                description: 'Scanned Bill',
                category: 'Food',
                paymentMode: 'cash',
                upiTxnId: '',
                detectedApp: 'unknown',
                imageUri: uri,
              };
              if (onScanComplete) {
                onScanComplete(fallbackResult);
                onClose();
              } else {
                onClose();
                setTimeout(() => {
                  router.push({
                    pathname: '/shared-payment',
                    params: { imageUri: uri },
                  });
                }, 120);
              }
            },
          },
          { text: 'Try Again', style: 'cancel' },
        ]
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Shutter tap: Capture photo with live camera
  const handleCapturePhoto = async () => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      setProcessingStatus('Capturing image...');

      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.6,
          skipProcessing: false,
        });
        if (photo?.uri) {
          await processImageUri(photo.uri);
          return;
        }
      }

      // Fallback if cameraRef didn't produce photo
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.6,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        await processImageUri(result.assets[0].uri);
      }
    } catch (e: any) {
      console.log('Camera capture error:', e);
      Alert.alert(
        'Camera Notice',
        'Could not capture from camera directly. You can pick the bill photo from your gallery.',
        [
          { text: 'Open Gallery', onPress: handleSelectFromGallery },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Pick payment screenshot or bill from device gallery
  const handleSelectFromGallery = async () => {
    if (isProcessing) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo Access Needed',
          'Please allow photo library access to pick bills or screenshots from your device.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.6,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        await processImageUri(result.assets[0].uri);
      }
    } catch (e: any) {
      Alert.alert('Gallery Error', e?.message || 'Could not select photo.');
    }
  };

  // Live Barcode / UPI QR Code Detection
  const handleBarcodeScanned = async (scanningResult: { data: string }) => {
    if (qrProcessed || isProcessing) return;
    const data = scanningResult.data;
    if (data && (data.startsWith('upi://pay') || data.startsWith('upi://'))) {
      setQrProcessed(true);
      try {
        setIsProcessing(true);
        setProcessingStatus('✨ Detected UPI QR Code...');

        const queryPart = data.includes('?') ? data.split('?')[1] : '';
        const searchParams = new URLSearchParams(queryPart);
        const pa = searchParams.get('pa') || '';
        const pn = decodeURIComponent(searchParams.get('pn') || '');
        const am = searchParams.get('am') || '';

        const result: ScannedBillResult = {
          amount: am,
          description: pn ? `Payment to ${pn}` : 'UPI QR Payment',
          category: 'General',
          paymentMode: 'upi',
          upiTxnId: pa,
          detectedApp: 'UPI QR',
          imageUri: '',
        };

        if (onScanComplete) {
          onScanComplete(result);
          onClose();
        } else {
          onClose();
          setTimeout(() => {
            router.push({
              pathname: '/shared-payment',
              params: {
                amount: am,
                description: result.description,
                receiverName: pn,
                upiId: pa,
              },
            });
          }, 120);
        }
      } catch (err) {
        console.log('Error parsing UPI QR:', err);
        setQrProcessed(false);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  if (!visible) return null;

  const hasPermission = Boolean(permission?.granted);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        {/* 1. Live Camera View */}
        {hasPermission ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFillObject}
            facing={facing}
            enableTorch={isTorchOn}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.noPermissionContainer]}>
            <View style={styles.noPermissionCard}>
              <View style={styles.noPermissionIconCircle}>
                <Ionicons name="camera-outline" size={38} color="#EAB308" />
              </View>
              <Text style={styles.noPermissionTitle}>Camera Permission Required</Text>
              <Text style={styles.noPermissionText}>
                Allow camera access to scan physical bills, restaurant receipts, and payment QR codes live.
              </Text>
              <TouchableOpacity
                style={styles.permissionActionBtn}
                onPress={() => requestPermission()}
              >
                <Text style={styles.permissionActionBtnText}>Allow Camera Access</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.permissionGalleryBtn}
                onPress={handleSelectFromGallery}
              >
                <Ionicons name="images-outline" size={18} color="#FFFFFF" />
                <Text style={styles.permissionGalleryBtnText}>Choose from Gallery Instead</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 2. Top Bar (Close, Title Badge, Torch) */}
        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 16) + 8 }]}>
          <TouchableOpacity
            style={styles.topIconBtn}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.topBadge}>
            <Ionicons name="sparkles" size={14} color="#EAB308" />
            <Text style={styles.topBadgeText}>AI SCANNER</Text>
          </View>

          <TouchableOpacity
            style={[styles.topIconBtn, isTorchOn && styles.topIconBtnActive]}
            onPress={() => setIsTorchOn(prev => !prev)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name={isTorchOn ? 'flash' : 'flash-outline'}
              size={22}
              color={isTorchOn ? '#EAB308' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </View>

        {/* 3. Center Scanner Viewfinder with Animated Laser */}
        <View style={styles.viewfinderContainer} pointerEvents="none">
          <View style={styles.scanReticle}>
            {/* 4 Corner Bracket Accents (Google Pay style) */}
            <View style={[styles.cornerBracket, styles.bracketTopLeft]} />
            <View style={[styles.cornerBracket, styles.bracketTopRight]} />
            <View style={[styles.cornerBracket, styles.bracketBottomLeft]} />
            <View style={[styles.cornerBracket, styles.bracketBottomRight]} />

            {/* Sweeping Laser Line */}
            <Animated.View
              style={[
                styles.laserBeam,
                {
                  transform: [{ translateY: laserAnim }],
                },
              ]}
            />
          </View>

          {/* User Guide Pill */}
          <View style={styles.guidePill}>
            <Ionicons name="scan-outline" size={15} color="#EAB308" />
            <Text style={styles.guidePillText}>
              Align bill, receipt or UPI QR code
            </Text>
          </View>
        </View>

        {/* 4. Bottom Controls (Gallery Button, Big Shutter Button, Flip Camera) */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) + 14 }]}>
          {/* Gallery Picker Button */}
          <TouchableOpacity
            style={styles.sideControlBtn}
            onPress={handleSelectFromGallery}
            activeOpacity={0.75}
          >
            <View style={styles.sideIconCircle}>
              <Ionicons name="images" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.sideControlText}>Gallery</Text>
          </TouchableOpacity>

          {/* Central Camera Shutter Button */}
          <TouchableOpacity
            style={styles.shutterOuter}
            onPress={handleCapturePhoto}
            activeOpacity={0.75}
            disabled={isProcessing}
          >
            <View style={styles.shutterInner}>
              <Ionicons name="camera" size={26} color="#000000" />
            </View>
          </TouchableOpacity>

          {/* Flip Camera Button */}
          <TouchableOpacity
            style={styles.sideControlBtn}
            onPress={() => setFacing(prev => (prev === 'back' ? 'front' : 'back'))}
            activeOpacity={0.75}
          >
            <View style={styles.sideIconCircle}>
              <Ionicons name="camera-reverse-outline" size={23} color="#FFFFFF" />
            </View>
            <Text style={styles.sideControlText}>Flip</Text>
          </TouchableOpacity>
        </View>

        {/* 5. Fullscreen AI Processing Overlay */}
        {isProcessing && (
          <View style={styles.processingOverlay}>
            <View style={styles.processingCard}>
              <ActivityIndicator size="large" color="#EAB308" />
              <Text style={styles.processingTitle}>{processingStatus}</Text>
              <Text style={styles.processingSubtitle}>
                Extracting amount, merchant & category automatically...
              </Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  topIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  topIconBtnActive: {
    backgroundColor: 'rgba(234, 179, 8, 0.25)',
    borderColor: '#EAB308',
  },
  topBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.4)',
  },
  topBadgeText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  viewfinderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  scanReticle: {
    width: SCAN_FRAME_WIDTH,
    height: SCAN_FRAME_HEIGHT,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'transparent',
  },
  cornerBracket: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#EAB308',
  },
  bracketTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 18,
  },
  bracketTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 18,
  },
  bracketBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 18,
  },
  bracketBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 18,
  },
  laserBeam: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 3,
    backgroundColor: '#EAB308',
    borderRadius: 2,
    shadowColor: '#EAB308',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },
  guidePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  guidePillText: {
    color: '#FFFFFF',
    fontSize: scaleFont(12),
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 28,
    paddingTop: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sideControlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 68,
  },
  sideIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  sideControlText: {
    color: '#FFFFFF',
    fontSize: scaleFont(11),
    fontWeight: '600',
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noPermissionContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 24,
  },
  noPermissionCard: {
    width: '100%',
    maxWidth: 340,
    padding: 24,
    borderRadius: 24,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  noPermissionIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  noPermissionTitle: {
    color: '#FFFFFF',
    fontSize: scaleFont(18),
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  noPermissionText: {
    color: '#94A3B8',
    fontSize: scaleFont(13),
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionActionBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#EAB308',
    alignItems: 'center',
    marginBottom: 10,
  },
  permissionActionBtnText: {
    color: '#000000',
    fontSize: scaleFont(14),
    fontWeight: '700',
  },
  permissionGalleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  permissionGalleryBtnText: {
    color: '#FFFFFF',
    fontSize: scaleFont(13),
    fontWeight: '600',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
    paddingHorizontal: 24,
  },
  processingCard: {
    width: '100%',
    maxWidth: 320,
    padding: 28,
    borderRadius: 24,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  processingTitle: {
    color: '#FFFFFF',
    fontSize: scaleFont(16),
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  processingSubtitle: {
    color: '#94A3B8',
    fontSize: scaleFont(12),
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
});
