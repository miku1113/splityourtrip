# SplitYourTrip - Agent Project Rules

## 1. Primary Knowledge Base & Token Optimization Rule
- **MANDATORY**: Before reading multiple files or exploring the project architecture, **ALWAYS consult [`docs/PROJECT_KNOWLEDGE.md`](file:///Users/mihir/Desktop/splitYourTrip/docs/PROJECT_KNOWLEDGE.md)**.
- `docs/PROJECT_KNOWLEDGE.md` contains the full directory map, store contracts, responsive design system, database schemas, and business rules.
- Using this file saves context window tokens, speeds up planning, and guarantees architectural consistency across all turns and tasks.

## 2. Currency & Financial Calculation Rules
- **Paise Unit Requirement**: All financial amounts in databases, Zustand stores, and state calculations MUST strictly be stored as integers in **Paise** (e.g. ₹100.00 = `10000`). NEVER use floating-point dollars/rupees.
- **Formatting**: Always format monetary amounts using `formatCurrencyAmount(amountPaise, userCurrency)` from `src/services/currency.ts`.
- **Member Identification**: Always use `findMyMember(members, userId, userPhone)` from `src/features/trips/useTripStore.ts` to locate the current active user in a trip. Never assume `role === 'admin'`.

## 3. Responsive UI System & Device Compatibility
- **All Devices Support**: The app must render without visual clipping, text overlapping, or broken layouts on compact devices (320px–360px), standard devices (375px–430px), foldable screens, iPads/tablets (600px–1024px+), and desktop web.
- **Hook**: Always use `useResponsive()` from `src/theme/responsive.ts` for dynamic width, height, `isSmall` (<375), `isTablet`, and clamped font scaling `scaleFont(size)`.
- **Tablet / Large Screen Max-Width**: Main scroll views must specify `contentContainerStyle={[styles.content, { maxWidth: 840, width: '100%', alignSelf: 'center' }]}`.
- **Modal Max-Width**: All `DraggableBottomSheet` instances must specify `sheetStyle={{ maxWidth: 640, alignSelf: 'center', width: '100%' }}`.
- **Number Clamping**: All numerical badges and currency labels must specify:
  ```tsx
  numberOfLines={1}
  adjustsFontSizeToFit={true}
  minimumFontScale={0.72}
  ```
- **Tag Wrapping**: Tag/badge rows must specify `flexWrap: 'wrap'` to prevent card overflow.

## 4. State Management & Offline Caching
- State stores reside in `src/features/` and are built with Zustand v5 (`useTripStore`, `useAuthStore`, `useContactsStore`, `useNotificationStore`, `useThemeStore`).
- Always preserve offline-first caching via `AppStorage` (`@splityourtrip_local_details_{tripId}`).
- When adding or editing expenses/settlements, ensure offline data is updated immediately and synced with Supabase.

## 5. TypeScript Integrity
- Preserve strict TypeScript typing. Always ensure `npx tsc --noEmit` compiles with 0 errors before completing any task.

## 6. Response Metrics & Performance Transparency
- **Mandatory Response Metrics**: At the end of every response or completed task, always provide a concise summary footer detailing:
  - **Total Time Taken**: Total duration / elapsed time to execute and respond to the request (e.g. `Time Elapsed: Xm Ys`).
  - **Token Usage**: Tokens consumed for the turn/answer including input, output, and total token count (e.g. `Tokens Used: ~X (Input: Y, Output: Z)`).
