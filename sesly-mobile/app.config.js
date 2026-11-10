require('dotenv').config();

module.exports = {
  expo: {
    name: "Sesly",
    slug: "sesly",
    version: "1.3.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    scheme: "sesly",
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.sesly",
      buildNumber: "9",
      usesAppleSignIn: true,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSMicrophoneUsageDescription: "Sesly, masalları senin sesinle anlatabilmek için ses örneği kaydetmek üzere mikrofonuna erişir.",
        // Pro background playback (expo-audio) + FCM/APNs remote notifications.
        // Mirrors ios/Sesly/Info.plist (committed native project is the build source).
        UIBackgroundModes: ["audio", "remote-notification"]
      },
      // APNs. Mirrors ios/Sesly/Sesly.entitlements (Release); Debug builds use
      // ios/Sesly/Sesly.Debug.entitlements with "development".
      entitlements: {
        "com.apple.developer.applesignin": ["Default"],
        "aps-environment": "production"
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#F6F0EA"
      },
      package: "com.sesly",
      permissions: [
        "RECORD_AUDIO",
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        // Android 13+ runtime permission for push; asked in context, not at launch.
        "POST_NOTIFICATIONS"
      ],
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false
    },
    plugins: [
      "expo-font",
      "expo-image",
      // Device locale for the UI language (src/i18n). Without options this
      // plugin changes nothing in the native projects; the module itself is
      // autolinked at build time.
      "expo-localization",
      // Native launch splash: the default palette bg (palettes['gece-mavisi'].bg) with the
      // 120dp bird mark centred, held until the first screen has drawn. Mirrors the
      // hand-applied android/ and ios/ files (styles.xml naming the splashscreen_logo
      // bitmaps directly, each the 288dp icon box with the mark at imageWidth in the
      // middle, and SplashScreen.storyboard); the images come from
      // scripts/generate-splash-assets.js, which leaves the box padding transparent where
      // the plugin would fill it with backgroundColor (the same picture on the launch colour).
      [
        "expo-splash-screen",
        {
          backgroundColor: "#121A29",
          image: "./assets/splash-mark.png",
          imageWidth: 120
        }
      ],
      [
        "expo-audio",
        {
          microphonePermission: "Sesly, masalları senin sesinle anlatabilmek için ses örneği kaydetmek üzere mikrofonuna erişir.",
          // Android lock screen / notification player: modules/sesly-media (its own
          // Media3 service and foreground-service permissions). Keeps prebuild from
          // adding expo-audio's AudioControlsService next to it. iOS background audio
          // stays on through ios.infoPlist.UIBackgroundModes above.
          enableBackgroundPlayback: false
        }
      ],
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24
          },
          ios: {
            deploymentTarget: "15.1",
            useFrameworks: "static"
          }
        }
      ],
      // In-app purchases (Google Play Billing, StoreKit 2). Mirrors the hand edit in
      // android/gradle.properties (openiapStore=play); the Billing library brings
      // com.android.vending.BILLING through the manifest merger.
      "expo-iap",
      // Crashlytics. Mirrors the hand edits in android/build.gradle (classpath
      // firebase-crashlytics-gradle) and android/app/build.gradle (the plugin and the
      // release mapping upload); the iOS dSYM upload phase is an owner step
      // (docs/release-pass/RELEASE-CHECKLIST.md).
      "@react-native-firebase/crashlytics"
    ],
    extra: {
      BASE_URL: process.env.BASE_URL,
      BASE_URL_PRODUCTION: process.env.BASE_URL_PRODUCTION,
      // Dev-only e2e hook (src/config/firebaseEmulator.ts); unset in real builds.
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      // Dev-only e2e flag: hides the LogBox overlay during Maestro runs.
      E2E: process.env.E2E,
      WEBSOCKET_URL: process.env.WEBSOCKET_URL,
      WEBSOCKET_URL_PRODUCTION: process.env.WEBSOCKET_URL_PRODUCTION,
      GOOGLE_WEB_CLIENT_ID: process.env.GOOGLE_WEB_CLIENT_ID,
      GOOGLE_PROJECT_NUMBER: process.env.GOOGLE_PROJECT_NUMBER,
      GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID,
      APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
      APPLE_REDIRECT_URI: process.env.APPLE_REDIRECT_URI,
      FIREBASE_APP_DOMAIN: process.env.FIREBASE_APP_DOMAIN,
      FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      ANDROID_PACKAGE_NAME: process.env.ANDROID_PACKAGE_NAME,
      IOS_BUNDLE_ID: process.env.IOS_BUNDLE_ID,
      APP_SCHEME: process.env.APP_SCHEME,
    }
  }
};
