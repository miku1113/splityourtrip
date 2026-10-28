import WidgetKit
import SwiftUI

// MARK: - SplitYourTrip Theme Colors
struct ThemeColors {
    // Muted Cobalt Primary
    static let primary = Color(red: 0.47, green: 0.58, blue: 0.72) // #7895B7
    static let primaryDark = Color(red: 0.36, green: 0.47, blue: 0.60) // #5B789A
    static let secondarySage = Color(red: 0.61, green: 0.71, blue: 0.63) // #9BB4A1
    static let cardBackground = Color(red: 0.14, green: 0.18, blue: 0.23) // #242D3B
    static let deepBackground = Color(red: 0.08, green: 0.11, blue: 0.15) // #151B25
    static let textLight = Color(red: 0.94, green: 0.95, blue: 0.91) // #F0F2E9
    static let textSecondary = Color(red: 0.64, green: 0.69, blue: 0.76) // #A3AFC2
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> VoiceExpenseEntry {
        VoiceExpenseEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (VoiceExpenseEntry) -> ()) {
        let entry = VoiceExpenseEntry(date: Date())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<VoiceExpenseEntry>) -> ()) {
        let timeline = Timeline(entries: [VoiceExpenseEntry(date: Date())], policy: .atEnd)
        completion(timeline)
    }
}

struct VoiceExpenseEntry: TimelineEntry {
    let date: Date
}

struct SplitYourTripWidgetsEntryView : View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            SmallVoiceWidgetView()
        case .systemMedium:
            MediumVoiceWidgetView()
        default:
            SmallVoiceWidgetView()
        }
    }
}

// MARK: - Small Home Screen Widget
struct SmallVoiceWidgetView: View {
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            gradient: Gradient(colors: [
                                ThemeColors.primary,
                                ThemeColors.primaryDark
                            ]),
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 52, height: 52)
                    .shadow(color: ThemeColors.primaryDark.opacity(0.35), radius: 6, x: 0, y: 3)

                Image(systemName: "mic.fill")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)
            }

            Text("Voice Expense")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(ThemeColors.textLight)

            Text("Tap to Speak")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(ThemeColors.primary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 8)
        .widgetURL(URL(string: "splityourtrip://voice-expense"))
    }
}

// MARK: - Medium Home Screen Widget
struct MediumVoiceWidgetView: View {
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            gradient: Gradient(colors: [
                                ThemeColors.primary,
                                ThemeColors.primaryDark
                            ]),
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 56, height: 56)
                    .shadow(color: ThemeColors.primaryDark.opacity(0.35), radius: 6, x: 0, y: 3)

                Image(systemName: "mic.fill")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("SPLIT YOUR TRIP")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundColor(ThemeColors.secondarySage)

                    Spacer()

                    Text("AI VOICE")
                        .font(.system(size: 9, weight: .black))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(ThemeColors.primary.opacity(0.18))
                        .foregroundColor(ThemeColors.primary)
                        .cornerRadius(4)
                }

                Text("Add Expense with Voice")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(ThemeColors.textLight)

                Text("Say: \"Add ₹45 in Goa trip paid by me...\"")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundColor(ThemeColors.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(URL(string: "splityourtrip://voice-expense"))
    }
}

// MARK: - Widget Bundle Definition
@main
struct SplitYourTripWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SplitYourTripVoiceWidget()
    }
}

struct SplitYourTripVoiceWidget: Widget {
    let kind: String = "SplitYourTripVoiceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                SplitYourTripWidgetsEntryView(entry: entry)
                    .containerBackground(for: .widget) {
                        ThemeColors.cardBackground
                    }
            } else {
                SplitYourTripWidgetsEntryView(entry: entry)
                    .padding()
                    .background(ThemeColors.cardBackground)
            }
        }
        .configurationDisplayName("Add Expense with Voice")
        .description("Quickly record and split an expense with your voice.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium
        ])
    }
}
