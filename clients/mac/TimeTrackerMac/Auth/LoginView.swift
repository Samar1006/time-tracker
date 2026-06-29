import SwiftUI

struct LoginView: View {
    @ObservedObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var email = "demo@timetracker.test"
    @State private var password = "Demo1234!"
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Log in to Time Tracker")
                .font(.headline)

            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .textContentType(.username)
                .disableAutocorrection(true)

            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
                .textContentType(.password)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button(isSubmitting ? "Signing in…" : "Sign in") {
                    submit()
                }
                .disabled(isSubmitting || email.isEmpty || password.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 360)
    }

    private func submit() {
        errorMessage = nil
        isSubmitting = true
        Task {
            do {
                try await appState.login(email: email, password: password)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}
