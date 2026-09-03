import AVFoundation
import SwiftUI

/// Warna emas logo, diambil dari huruf "ONE" pada lambang ONE7ELEVEN.
extension Color {
    static let emas      = Color(red: 0.85, green: 0.69, blue: 0.28)
    static let emasTerang = Color(red: 0.99, green: 0.93, blue: 0.66)
    static let emasTua   = Color(red: 0.63, green: 0.45, blue: 0.11)
    static let unguTua   = Color(red: 0.20, green: 0.13, blue: 0.32)
}

/*
 Sapuan emas untuk tulisan besar — meniru kilau logam pada lambangnya.

 Ditulis sebagai LinearGradient, bukan sebagai View. `foregroundStyle` menuntut
 ShapeStyle; membungkusnya dalam View membuatnya tidak bisa dipakai mewarnai
 teks sama sekali.
 */
let sapuanEmas = LinearGradient(
    colors: [.emasTua, .emas, .emasTerang, .emas, .emasTua],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
)

struct ContentView: View {
    @StateObject private var perekam = Perekam()

    var body: some View {
        ZStack {
            Image("Latar")
                .resizable()
                .scaledToFill()
                .ignoresSafeArea()

            switch perekam.tahap {
            case .beranda:      Beranda(perekam: perekam)
            case .hitungMundur: Kamera(perekam: perekam) { HitunganBesar(angka: perekam.hitungMundur) }
            case .merekam:      Kamera(perekam: perekam) { LapisRekam(sisa: perekam.sisaDetik) }
            case .kirim:        LayarKirim(perekam: perekam)
            }
        }
        .statusBar(hidden: true)
        .persistentSystemOverlays(.hidden)
        .task { await perekam.siapkan() }
    }
}

// MARK: - Beranda

private struct Beranda: View {
    @ObservedObject var perekam: Perekam
    @State private var berdenyut = false

    var body: some View {
        VStack {
            Spacer()

            Text("Start to Whisper Your Wishes")
                .font(.system(size: 78, weight: .semibold, design: .serif))
                .kerning(1.5)
                .multilineTextAlignment(.center)
                .foregroundStyle(sapuanEmas)
                .shadow(color: .unguTua.opacity(0.55), radius: 14, y: 5)
                .padding(.horizontal, 80)
                .scaleEffect(berdenyut ? 1.03 : 1.0)
                .animation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true), value: berdenyut)

            Text(perekam.siap ? "Tap anywhere to begin" : "Preparing camera…")
                .font(.system(size: 26, weight: .medium, design: .serif))
                .foregroundStyle(.white.opacity(0.82))
                .padding(.top, 34)

            if !perekam.pesan.isEmpty {
                Text(perekam.pesan)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.top, 16)
                    .padding(.horizontal, 60)
                    .multilineTextAlignment(.center)
            }

            Spacer()
            Spacer().frame(height: 40)
        }
        // Seluruh layar bisa ditekan, bukan hanya tulisannya. Tamu di acara
        // menyentuh ke arah kata-katanya, bukan tepat pada hurufnya.
        .contentShape(Rectangle())
        .onTapGesture { perekam.mulai() }
        .onAppear { berdenyut = true }
    }
}

// MARK: - Kamera

private struct Kamera<Lapis: View>: View {
    @ObservedObject var perekam: Perekam
    @ViewBuilder var lapis: () -> Lapis

    var body: some View {
        ZStack {
            PratinjauKamera(sesi: perekam.sesi)
                .ignoresSafeArea()
            lapis()
        }
    }
}

/// Pratinjau kamera. Diselipkan dari UIKit karena SwiftUI belum punya padanannya.
private struct PratinjauKamera: UIViewRepresentable {
    let sesi: AVCaptureSession

    func makeUIView(context: Context) -> LapisanKamera {
        let v = LapisanKamera()
        v.lapisan.session = sesi
        v.lapisan.videoGravity = .resizeAspectFill
        return v
    }

    func updateUIView(_ uiView: LapisanKamera, context: Context) {}
}

private final class LapisanKamera: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var lapisan: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

// MARK: - Lapisan di atas kamera

private struct HitunganBesar: View {
    let angka: Int

    var body: some View {
        ZStack {
            Color.black.opacity(0.28).ignoresSafeArea()
            Text("\(max(angka, 1))")
                .font(.system(size: 260, weight: .bold, design: .serif))
                .foregroundStyle(sapuanEmas)
                .shadow(color: .black.opacity(0.5), radius: 20)
                // Elemen diberi id angkanya agar animasinya dimulai ulang tiap
                // detik; tanpa itu hanya angka pertama yang terlihat bergerak.
                .id(angka)
                .transition(.scale.combined(with: .opacity))
                .animation(.spring(duration: 0.35), value: angka)
        }
    }
}

private struct LapisRekam: View {
    let sisa: Int

    var body: some View {
        VStack {
            HStack(spacing: 14) {
                Circle()
                    .fill(.red)
                    .frame(width: 20, height: 20)
                    .shadow(color: .red.opacity(0.8), radius: 8)

                Text("\(sisa)s")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .monospacedDigit()
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 14)
            .background(.black.opacity(0.42), in: Capsule())
            .padding(.top, 40)

            Spacer()

            Text("Whisper your wishes…")
                .font(.system(size: 34, weight: .medium, design: .serif))
                .foregroundStyle(.white.opacity(0.92))
                .shadow(color: .black.opacity(0.6), radius: 10)
                .padding(.bottom, 52)
        }
    }
}

// MARK: - Kirim

private struct LayarKirim: View {
    @ObservedObject var perekam: Perekam
    @State private var mengirim = false

    var body: some View {
        VStack {
            Spacer()

            Text("Your Wishes Are Ready")
                .font(.system(size: 62, weight: .semibold, design: .serif))
                .foregroundStyle(sapuanEmas)
                .shadow(color: .unguTua.opacity(0.55), radius: 14, y: 5)

            Text("Tap below to send them to EWALK")
                .font(.system(size: 24, weight: .medium, design: .serif))
                .foregroundStyle(.white.opacity(0.82))
                .padding(.top, 18)

            Button {
                guard !mengirim else { return }
                mengirim = true
                perekam.kirim()
            } label: {
                Text(mengirim ? "Sending…" : "Send Your Wishes")
                    .font(.system(size: 38, weight: .bold, design: .serif))
                    .foregroundStyle(Color.unguTua)
                    .padding(.horizontal, 66)
                    .padding(.vertical, 26)
                    .background(sapuanEmas, in: Capsule())
                    .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
            }
            .disabled(mengirim)
            .padding(.top, 54)

            Spacer()
            Spacer().frame(height: 40)
        }
    }
}
