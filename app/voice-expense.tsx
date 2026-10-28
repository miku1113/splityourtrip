import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTripStore } from '../src/features/trips/useTripStore';

export default function VoiceExpenseRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Open the Voice Assistant Drawer on the home screen
    useTripStore.getState().setVoiceModalOpen(true);
    // Replace route with the main tabs screen
    router.replace('/(tabs)');
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
