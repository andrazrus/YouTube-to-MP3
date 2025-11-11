import SwiftUI

// MARK: - Brand Colors (match your web CSS)
extension Color {
    static let appBgTop      = Color(red: 0x11/255, green: 0x15/255, blue: 0x28/255)
    static let appBgMain     = Color(red: 0x0b/255, green: 0x0d/255, blue: 0x14/255)
    static let panel         = Color(red: 0x0c/255, green: 0x0e/255, blue: 0x16/255).opacity(0.70)
    static let stroke        = Color(red: 0x23/255, green: 0x28/255, blue: 0x3a/255)
    static let textPrimary   = Color(red: 0xe9/255, green: 0xec/255, blue: 0xf1/255)
    static let textMuted     = Color(red: 0x9a/255, green: 0xa2/255, blue: 0xb1/255)
    static let blueStart     = Color(red: 0x6e/255, green: 0x87/255, blue: 0xff/255)
    static let blueEnd       = Color(red: 0x4f/255, green: 0x6c/255, blue: 0xff/255)
    static let redStart      = Color(red: 1.0,        green: 0.42,      blue: 0.51)
    static let redEnd        = Color(red: 1.0,        green: 0.28,      blue: 0.39)
    static let fieldBg       = Color(red: 0x0b/255,   green: 0x0f/255,   blue: 0x18/255)
}

// MARK: - Background
struct AppBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [.appBgMain, .appBgTop], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            RadialGradient(gradient: Gradient(colors: [Color.white.opacity(0.05), .clear]),
                           center: .topLeading, startRadius: 60, endRadius: 450)
                .ignoresSafeArea()
        }
    }
}

// MARK: - Card
struct Card<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        content
            .padding(16)
            .background(.ultraThinMaterial.opacity(0.06))
            .background(Color.panel)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.stroke, lineWidth: 1))
            .cornerRadius(18)
            .shadow(color: .black.opacity(0.35), radius: 24, y: 10)
    }
}

// MARK: - Buttons
struct PrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                LinearGradient(colors: [.blueStart, .blueEnd], startPoint: .top, endPoint: .bottom)
                    .opacity(configuration.isPressed ? 0.85 : 1)
            )
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.blueEnd.opacity(0.6), lineWidth: 1))
            .foregroundColor(.textPrimary)
            .cornerRadius(14)
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}

struct OutlineButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(LinearGradient(colors: [Color(white: 0.09), Color(white: 0.06)],
                                       startPoint: .top, endPoint: .bottom))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.stroke, lineWidth: 1))
            .foregroundColor(.textPrimary)
            .cornerRadius(14)
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}

struct DangerButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(LinearGradient(colors: [.redStart, .redEnd], startPoint: .top, endPoint: .bottom))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.redEnd.opacity(0.6), lineWidth: 1))
            .foregroundColor(.black.opacity(0.85))
            .cornerRadius(14)
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}

// MARK: - Fields
struct DarkTextField: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(12)
            .background(Color.fieldBg)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.stroke, lineWidth: 1))
            .cornerRadius(12)
            .foregroundColor(.textPrimary)
    }
}
extension View { func darkField() -> some View { modifier(DarkTextField()) } }
