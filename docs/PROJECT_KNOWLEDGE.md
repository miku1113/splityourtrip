# SplitYourTrip - Master Codebase & Architecture Knowledge Base

> **Token-Saving Master Reference**: This single document captures the entire architecture, file tree, data flows, business logic, responsive design system, database schemas, and state stores of the **SplitYourTrip** mobile app. AI coding assistants and developers should consult this file first before reading dozens of source files, saving context tokens and preventing regressions.

---

## 1. Application Overview & Tech Stack

**SplitYourTrip** is a cross-platform group travel expense splitting, settlement, and collaborative trip management app built with React Native and Expo. It supports group trips, 1-on-1 friend splits, real-time trip group chats, offline-first local caching, bill OCR scanning, UPI deep-linking payments, and deep spending analysis.

### Core Stack
- **Framework**: Expo SDK 51 (`~51.0.38`), React Native `0.74.5`, React `18.2.0`
- **Routing**: Expo Router v3 (`expo-router ~3.5.23`) with file-based navigation
- **Backend / Database**: Supabase (`@supabase/supabase-js ^2.78.0`) with PostgreSQL, Row Level Security (RLS), Realtime Broadcast Channels, and Storage Buckets
- **State Management**: Zustand v5 (`zustand ^5.0.15`)
- **Query & Data Caching**: TanStack React Query v5 (`@tanstack/react-query ^5.104.0`) + AsyncStorage (`@react-native-async-storage/async-storage 1.23.1`)
- **UI & Graphics**: React Native SVG (`react-native-svg 15.2.0`), Reanimated 3 (`react-native-reanimated ~3.10.1`), Expo Vector Icons (`@expo/vector-icons ^14.0.2`), Safe Area Context (`react-native-safe-area-context 4.10.5`)
- **Native Device APIs**: `expo-camera`, `expo-contacts`, `expo-file-system`, `expo-image-picker`, `expo-image-manipulator`, `expo-notifications`, `expo-linking`, `expo-document-picker`

---

## 2. Directory & File Organization

```
splitYourTrip/
├── app/                            # Expo Router File-Based Pages & Layouts
│   ├── _layout.tsx                 # Root layout, Auth listener, Fonts, Theme, Global Toast
│   ├── +html.tsx                   # Web HTML template
│   ├── +not-found.tsx              # 404 screen
│   ├── (auth)/
│   │   └── login.tsx               # Phone OTP & Google Sign-In
│   ├── (tabs)/
│   │   ├── _layout.tsx             # 5-Tab bar navigation (Trips, Friends, Center Add, Analyser, Profile)
│   │   ├── index.tsx               # Trips Tab: Active & settled trips, balances summary, offline status
│   │   ├── friends.tsx             # Friends Tab: 1-on-1 splits, contact balances, settle friend modal
│   │   ├── center-action.tsx       # Center Tab Button: Quick modal for Add Trip / Add Expense / Scan Bill
│   │   ├── analyser.tsx            # Analyser Tab: Spending trends, line chart, categories, daily velocity
│   │   └── profile.tsx             # Profile Tab: Currency preference, backup/export, account settings
│   ├── trip/
│   │   └── [id]/
│   │       ├── index.tsx           # Trip Screen: Feed, live chat, balances, settle up, media tab
│   │       ├── settings.tsx        # Trip Settings: Edit name, invite code, members list, role changes
│   │       ├── add.tsx             # Add / Edit Expense inside trip
│   │       ├── info.tsx            # Trip Overview & Member stats
│   │       └── expense/
│   │           └── [expenseId].tsx # Expense Detail: Split breakdowns, attachment viewer, dispute button
│   ├── all-expenses.tsx            # Full paginated expense list with multi-filter and search
│   ├── add-trip.tsx                # Create new group trip with currency and members
│   ├── add-expense.tsx             # Standalone / global add expense
│   ├── add-contact.tsx             # Invite or add friend contact
│   ├── shared-payment.tsx          # Shared payment / settle link screen
│   ├── google-drive-backup.tsx     # Google Drive export and backup management
│   ├── privacy.tsx / about.tsx     # Static policy and legal pages
│   └── settings.tsx                # App settings
│
├── src/
│   ├── types/
│   │   └── database.ts             # TypeScript interfaces for Supabase DB schema & models
│   ├── features/                   # Zustand Stores & Business Logic
│   │   ├── auth/useAuthStore.ts    # Session, User profile, phone authentication
│   │   ├── trips/useTripStore.ts   # Core store: Trips, members, expenses, balances, sync
│   │   ├── contacts/useContactsStore.ts # Phone contacts, 1-on-1 balances, friend summary
│   │   └── notifications/useNotificationStore.ts # In-app notification queue & toasts
│   ├── components/                 # Reusable UI Components
│   │   ├── SpendingLineChart.tsx   # Interactive Catmull-Rom SVG line chart (Week/Month/Year)
│   │   ├── DraggableBottomSheet.tsx# Gesture bottom sheet with snap points & auto-close
│   │   ├── StandardBottomSheet.tsx # Standard bottom sheet modal
│   │   ├── AnalyserSkeleton.tsx    # Responsive animated shimmer skeleton for Analyser
│   │   ├── TripsListSkeleton.tsx   # Shimmer skeleton for Trips list
│   │   ├── FriendsListSkeleton.tsx # Shimmer skeleton for Friends list
│   │   ├── ChatFeedSkeleton.tsx    # Shimmer skeleton for Chat messages
│   │   ├── ProfileSkeleton.tsx     # Shimmer skeleton for Profile
│   │   ├── SettleUpModal.tsx       # Settlement calculation & UPI deep-linking modal
│   │   ├── BillScannerModal.tsx    # Camera receipt & OCR scanner
│   │   ├── ChatView.tsx            # Realtime trip chat message list & input bar
│   │   ├── NotificationToast.tsx   # Global animated toast banner
│   │   ├── NotificationCenterModal.tsx # In-app notification drawer
│   │   ├── AddExpenseChoiceModal.tsx# Action sheet for choosing Manual vs OCR expense
│   │   └── SidebarDrawer.tsx       # Collapsible side drawer navigation
│   ├── services/                   # Utility & External Integration Services
│   │   ├── currency.ts             # Currency formatting (INR, USD, EUR, GBP) & user preference
│   │   ├── expenseAggregator.ts    # Aggregation for cross-trip analysis & explorer
│   │   ├── split.ts                # Split algorithms: Equal, exact, percentage, shares
│   │   ├── settle.ts               # Debt simplification & optimal settlement graph algorithm
│   │   ├── imageUpload.ts          # Supabase storage upload & local file persistence
│   │   ├── pushNotificationService.ts # Expo push token registration & push handlers
│   │   ├── whatsappService.ts      # WhatsApp settlement share templates
│   │   ├── upiParser.ts            # Indian UPI QR and intent URI generator
│   │   ├── receiptOcr.ts           # Receipt parsing logic
│   │   ├── chatOutboxService.ts    # Offline chat queue with auto-retry
│   │   ├── friendsApi.ts           # Friends backend queries
│   │   └── googleDriveBackupService.ts # Backup exports
│   ├── theme/
│   │   ├── colors.ts               # Light/Dark semantic color palettes
│   │   ├── responsive.ts           # Dynamic responsive hooks (`useResponsive`, `scaleFont`, `Device`)
│   │   └── useThemeStore.ts        # Persistent theme state (Dark / Light / System)
│   └── lib/
│       ├── storage.ts              # AppStorage wrapper for AsyncStorage
│       └── supabase.ts             # Supabase client & admin client initialization
│
├── supabase/                       # Supabase Database Migrations & Schemas
│   ├── migrations/                 # PostgreSQL migrations
│   └── master_fix.sql              # Master idempotent schema and RLS policies
│
└── docs/                           # Project Documentation
    └── PROJECT_KNOWLEDGE.md        # This master reference document
```

---

## 3. Critical Business & Financial Rules

### 💰 1. All Monetary Amounts Are in Paise (Integer)
- In the database and all state stores, **ALL amounts are strictly stored as integers in Paise** (or lowest fractional currency unit, e.g. 10000 = ₹100.00).
- **NEVER** store or calculate floating-point dollars/rupees directly in database columns or store states.
- To display money to users, **ALWAYS** call:
  ```ts
  import { formatCurrencyAmount } from '../services/currency';
  formatCurrencyAmount(amountInPaise, userCurrency); // e.g. formatCurrencyAmount(150000, 'INR') -> "₹1,500"
  ```

### 👤 2. Active Member Resolution (`findMyMember`)
- In group trips, the active user may be an admin, an invited member, or a guest.
- **NEVER** assume the logged-in user is `members[0]` or `members.find(m => m.role === 'admin')`.
- Always use the universal helper:
  ```ts
  import { findMyMember } from '../features/trips/useTripStore';
  const myMember = findMyMember(tripMembers, user?.id, userPhone);
  ```

### 📱 3. Phone Number Normalization (`normalizePhone`)
- Phone numbers can be entered with country codes (`+91`), spaces, hyphens, or brackets.
- Always use `normalizePhone(phone)` which extracts the canonical 10-digit suffix for reliable cross-matching.

### 🔄 4. Split Types
- `equal`: Total amount divided evenly among selected members (remainder distributed by 1 paise).
- `exact`: Exact paise amount specified per member.
- `percentage`: Percentage per member (must total 100%).
- `shares`: Ratio of shares per member (e.g. 2 shares : 1 share).

---

## 4. Responsive UI Design System (All Screen Sizes)

The app is built to run flawlessly across compact phones (320px–360px), standard phones (375px–430px), foldable devices, iPads/tablets (600px–1024px+), and desktop browsers.

### The `useResponsive()` Hook (`src/theme/responsive.ts`)
Always import and use `useResponsive()` for dynamic, orientation-aware layout adaptation:
```ts
import { useResponsive } from '../../src/theme/responsive';

const {
  width,         // Current window width in dp
  height,        // Current window height in dp
  isSmall,       // true if width < 375 (iPhone SE 1st gen, small Android phones)
  isMedium,      // true if 375 <= width < 420
  isLarge,       // true if 420 <= width < 768
  isTablet,      // true if width >= 768 or aspect ratio < 1.45 (iPad, Galaxy Tab)
  scaleFont: sf, // Responsive font scaler with strict clamp (prevents text ballooning)
  moderateScale: ms, // Dampened scaling for paddings, margins, icons
} = useResponsive();
```

### Core Responsiveness Rules:
1. **Tablet & Desktop Max-Width Containment**:
   - On screens wider than 600px, main scroll views must NEVER stretch across 1200px:
     ```tsx
     contentContainerStyle={[styles.content, { maxWidth: 840, width: '100%', alignSelf: 'center' }]}
     ```
2. **Bottom Sheet Centering on Tablets**:
   - Draggable bottom sheets must constrain width on tablets:
     ```tsx
     sheetStyle={{ maxWidth: 640, alignSelf: 'center', width: '100%', paddingBottom: 20 }}
     ```
3. **Number Wrapping Prevention**:
   - All currency and numerical metrics must specify:
     ```tsx
     numberOfLines={1}
     adjustsFontSizeToFit={true}
     minimumFontScale={0.72}
     ```
4. **Hero Stats Matrix Adaptive Grid**:
   - On ultra-compact screens (`width < 360`), 4 side-by-side stats will collide. Use a **2x2 grid** on `< 360px` and **4-column row** on `>= 360px`.
5. **Tag Rows Wrapping**:
   - All badge/tag containers (date, mode, share) must include `flexWrap: 'wrap'` and `gap: 4` or `5` to prevent overflowing the card boundary.
6. **Text Inputs in Top Control Bars**:
   - On small screens (`width < 360`), use concise placeholders (e.g. `"Search friends, trips..."`) and responsive font sizes (`sf(13)`).

---

## 5. State Management & Data Architecture

### `useTripStore` (`src/features/trips/useTripStore.ts`)
- **State**:
  - `trips: Trip[]` - Master list of all user's trips (group trips & 1-on-1 friend split trips).
  - `expenses: Expense[]` - Normalized expenses for active/loaded trips.
  - `members: TripMember[]` - Members of active trips.
  - `balances: Record<string, TripBalanceRow[]>` - Precomputed net balance rows per trip.
- **Key Methods**:
  - `initTrips()`: Loads user trips from Supabase and local cache.
  - `createTrip(name, currency, memberNames)`: Creates trip in Supabase and offline cache.
  - `addExpense(tripId, expenseData)`: Inserts expense, updates splits, recalculates balances, and broadcasts in realtime.
  - `settlePayment(tripId, fromMemberId, toMemberId, amountPaise)`: Records settlement and rebalances.
  - `computeBalances(tripId, members, expenses)`: Computes pairwise debit/credit graph.

### `useContactsStore` (`src/features/contacts/useContactsStore.ts`)
- Manages phone contacts, matches registered Supabase profiles by phone, and aggregates cross-trip 1-on-1 friend balances (`friendsSummary`: `totalOwedToYouPaise`, `totalYouOwePaise`, `netOverallPaise`).

### `useAuthStore` (`src/features/auth/useAuthStore.ts`)
- Manages Supabase Auth session, JWT token refresh, user profile metadata (`full_name`, `avatar_url`, `phone_number`, `currency`), and logout cleanup.

### `useThemeStore` (`src/theme/useThemeStore.ts`)
- Supports `'dark'`, `'light'`, and `'system'` modes with instant theme persistence in `AppStorage`.

---

## 6. Offline-First Caching & Realtime Sync

1. **Local Details Cache**:
   - Detailed trip payload is cached locally under `@splityourtrip_local_details_${tripId}`.
   - When the user opens a trip while offline or with slow network, it renders immediately from local cache.
2. **Chat Outbox Service (`src/services/chatOutboxService.ts`)**:
   - Messages sent while offline are queued in SQLite/AppStorage and auto-flushed when network connectivity is restored.
3. **Supabase Realtime**:
   - Trips, expenses, and chat messages subscribe to Supabase Postgres Changes and Broadcast Channels for zero-latency live updates across all trip members' devices.

---

## 7. Fast Navigation & Sub-Path Reference

| Feature / Screen | File Location | Key Component / Logic |
| :--- | :--- | :--- |
| **Spending Analyser** | `app/(tabs)/analyser.tsx` | Hero matrix, line chart, daily groupings, autocomplete filter |
| **Spending Line Chart** | `src/components/SpendingLineChart.tsx` | SVG Bezier curve, touch scrub gesture, period selector |
| **All Expenses Screen** | `app/all-expenses.tsx` | Paginated virtualized list, multi-category & sorting |
| **Group Trip Dashboard** | `app/trip/[id]/index.tsx` | Live expense feed, realtime chat, settled status |
| **Settle Up Modal** | `src/components/SettleUpModal.tsx` | Pairwise net balance, UPI intent generation, cash settlement |
| **Bill OCR Scanner** | `src/components/BillScannerModal.tsx` | Camera feed, bounding box overlay, receipt OCR extraction |
| **Theme & Colors** | `src/theme/colors.ts` | Dark mode `#151B25`, Primary Blue `#4A90E2`, Slate cards |
| **Responsive Engine** | `src/theme/responsive.ts` | `useResponsive`, `scaleFont`, `isSmallDevice`, `isTablet` |
