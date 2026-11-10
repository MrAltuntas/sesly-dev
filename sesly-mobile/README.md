# Sesly - AI Voice Cloning Storytelling App

An AI-powered voice cloning storytelling mobile application built with React Native and TypeScript.

## Features

- 🎙️ **Hybrid Voice System**: Choose from ready-made Google TTS voices or clone your own voice
- 📚 **Story Library**: Browse and listen to stories across various categories and age groups
- 🎧 **Audio Playback**: Seamless audio streaming with background playback support
- 🔐 **Authentication**: Firebase Auth with Google Sign-In and Apple Sign-In
- 💎 **Premium Subscriptions**: In-app purchases for pro features
- 🔄 **Real-time Updates**: WebSocket integration for live status updates
- 🌙 **Modern UI**: Clean, responsive interface with gesture support

## Tech Stack

- **React Native** 0.76.5 with **TypeScript** (strict mode)
- **React Navigation** for navigation
- **Axios** for HTTP requests
- **Socket.IO** for WebSocket real-time updates
- **Firebase Auth** (Google Sign-In, Apple Sign-In)
- **react-native-track-player** for audio playback
- **expo-audio** for voice recording
- **React Native IAP** for in-app purchases
- **Encrypted Storage** for secure token storage

## Prerequisites

- Node.js >= 18
- npm >= 9
- React Native development environment set up:
  - For Android: Android Studio with SDK
  - For iOS: Xcode with CocoaPods

## Installation

1. Clone the repository:
\`\`\`bash
git clone https://github.com/your-repo/sesly.git
cd sesly
\`\`\`

2. Install dependencies:
\`\`\`bash
npm install
\`\`\`

3. Set up environment variables:
\`\`\`bash
cp .env.example .env
# Edit .env with your API keys and configuration
\`\`\`

4. For iOS, install pods:
\`\`\`bash
cd ios && pod install && cd ..
\`\`\`

## Running the App

### Android
\`\`\`bash
npm run android
\`\`\`

### iOS
\`\`\`bash
npm run ios
\`\`\`

### Start Metro Bundler
\`\`\`bash
npm start
\`\`\`

## Development

### Type Checking
\`\`\`bash
npm run type-check
\`\`\`

### Linting
\`\`\`bash
npm run lint
\`\`\`

### Format Code
\`\`\`bash
npm run format
\`\`\`

## Project Structure

\`\`\`
sesly/
├── src/
│   ├── config/          # Configuration and constants
│   ├── models/          # TypeScript interfaces and models
│   ├── services/        # API services (Auth, VoiceProfile, Story, etc.)
│   ├── screens/         # React Native screens
│   ├── components/      # Reusable UI components
│   ├── navigation/      # React Navigation setup
│   ├── theme/           # Colors, fonts, and styles
│   ├── types/           # TypeScript type definitions and enums
│   └── utils/           # Utility functions
├── android/             # Android native code
├── ios/                 # iOS native code
├── App.tsx              # Root component
└── index.js             # Entry point
\`\`\`

## Key Services

### ApiClient
Axios-based HTTP client with automatic token refresh and error handling.

### AuthService
Handles Firebase authentication, Google Sign-In, and Apple Sign-In.

### VoiceProfileService
Manages voice profiles, voice samples, and cloning operations.

### StoryService
Handles story browsing, audio generation, and playback.

### NarrationService
Manages narrations (audio generation) for stories.

## Configuration

### Firebase Setup

1. Add \`google-services.json\` to \`android/app/\`
2. Add \`GoogleService-Info.plist\` to \`ios/\`

### Environment Variables

See \`.env.example\` for required environment variables:
- API endpoints
- Google OAuth credentials
- Apple Sign-In configuration
- Firebase configuration
- In-app purchase product IDs

## Building for Production

### Android
\`\`\`bash
cd android
./gradlew clean
cd ..
npx react-native run-android --variant=release
\`\`\`

### iOS
\`\`\`bash
cd ios
pod install
cd ..
npx react-native run-ios --configuration Release
\`\`\`

## Troubleshooting

### Module Resolution Errors
\`\`\`bash
npm run start -- --reset-cache
\`\`\`

### Android Build Errors
\`\`\`bash
cd android && ./gradlew clean && cd ..
\`\`\`

### iOS Build Errors
\`\`\`bash
cd ios && pod deintegrate && pod install && cd ..
\`\`\`

### TypeScript Errors
All code must pass strict type checking. Run:
\`\`\`bash
npm run type-check
\`\`\`

## Contributing

1. Follow TypeScript strict mode - no \`any\` types
2. Use provided model parsers for type safety
3. Run \`npm run type-check\` before committing
4. Follow existing code structure and patterns

## License

Proprietary - All rights reserved

## Support

For issues or questions, please contact the development team.
