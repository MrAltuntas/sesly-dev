import { getApp, getApps, initializeApp } from '@react-native-firebase/app';

import {FIREBASE_CONFIG} from '../config/constants';

// Initialize Firebase
export const initializeFirebase = async () => {
  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp(FIREBASE_CONFIG);
};

export const ensureFirebaseInitialized = initializeFirebase;