import SwiftUI

@main
struct WhisperWishesApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                // Layar tidak boleh meredup di tengah acara: iPad dibiarkan
                // menyala menghadap tamu, dan tanpa ini ia tidur sendiri
                // beberapa menit kemudian.
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }
}
