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

/*
 Mode pratinjau untuk membuat tangkapan layar dokumentasi.

 Hanya ada di build DEBUG dan hanya menyala kalau dijalankan dengan argumen
 `-pratinjau <tahap>`. Simulator iOS tidak punya kamera sama sekali, jadi tanpa
 jalan pintas ini tidak ada cara melihat layar hitung mundur, layar rekam,
 maupun layar kirim sebelum ada iPad sungguhan di tangan.
 */
enum Pratinjau {
    static var tahap: Tahap? {
        #if DEBUG
        let arg = ProcessInfo.processInfo.arguments
        guard let i = arg.firstIndex(of: "-pratinjau"), i + 1 < arg.count else { return nil }
        switch arg[i + 1] {
        case "beranda": return .beranda
        case "hitung":  return .hitungMundur
        case "rekam":   return .merekam
        case "kirim":   return .kirim
        default:        return nil
        }
        #else
        return nil
        #endif
    }

    /// `-alur` menjalankan hitung mundur sungguhan tanpa perlu disentuh,
    /// supaya alurnya bisa diuji di simulator yang tidak punya kamera.
    static var ujiAlur: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("-alur")
        #else
        return false
        #endif
    }
}

struct ContentView: View {
    @StateObject private var perekam = Perekam()

    private var tahapTampil: Tahap { Pratinjau.tahap ?? perekam.tahap }
    private var pratinjau: Bool { Pratinjau.tahap != nil }

    var body: some View {
        ZStack {
            /*
             SATU lapisan pratinjau kamera untuk seumur hidup aplikasi.

             Sebelumnya ada dua `Kamera(...)` terpisah di dua cabang switch.
             SwiftUI menganggapnya dua tampilan berbeda, jadi saat berpindah
             dari hitung mundur ke merekam, lapisan pratinjau lama dibongkar
             dan yang baru dipasang. Memasang-lepas AVCaptureVideoPreviewLayer
             pada sesi yang sedang berjalan MENATA ULANG sesi itu — tepat pada
             detik perekaman dimulai — dan perekamannya berhenti dengan
             AVErrorSessionWasInterrupted tanpa satu pun pemberitahuan gangguan,
             karena yang mengganggu adalah aplikasinya sendiri.

             Dengan satu lapisan yang tidak pernah dibongkar, perpindahan tahap
             hanya mengganti hiasan di atasnya.
             */
            if pratinjau {
                LinearGradient(colors: [Color(white: 0.16), Color(white: 0.30)],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                Text("kamera depan")
                    .font(.system(size: 22, weight: .medium, design: .serif))
                    .foregroundStyle(.white.opacity(0.28))
            } else {
                PratinjauKamera(sesi: perekam.sesi, sudut: perekam.sudutSekarang)
                    .ignoresSafeArea()
            }

            // Latar menutupi kamera pada tahap yang memang tidak memerlukannya.
            if tahapTampil == .beranda || tahapTampil == .kirim {
                Image("Latar")
                    .resizable()
                    .scaledToFill()
                    .ignoresSafeArea()
            }

            switch tahapTampil {
            case .beranda:
                Beranda(perekam: perekam, paksaSiap: pratinjau)
            case .hitungMundur:
                // Angkanya WAJIB dari perekam. Sempat ditulis tetap 3 saat mode
                // pratinjau ditambahkan, dan akibatnya layar selalu menampilkan
                // 3 meski hitungannya berjalan normal di belakang layar.
                HitunganBesar(angka: pratinjau ? 3 : perekam.hitungMundur)
            case .merekam:
                LapisRekam(sisa: pratinjau ? 24 : perekam.sisaDetik)
            case .kirim:
                LayarKirim(perekam: perekam)
            }
        }
        .overlay(alignment: .bottomLeading) {
            // Baris diagnosis sementara. Kecil dan redup supaya tidak mengganggu
            // tamu, tetapi terbaca di foto layar saat memeriksa masalah.
            Text(perekam.diagnosa)
                .font(.system(size: 13, weight: .regular, design: .monospaced))
                .foregroundStyle(.white.opacity(0.45))
                .padding(10)
        }
        .statusBar(hidden: true)
        .persistentSystemOverlays(.hidden)
        .task {
            if pratinjau { return }
            await perekam.siapkan()
            if Pratinjau.ujiAlur {
                perekam.paksaSiap()
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                perekam.mulai()
            }
        }
    }
}

// MARK: - Beranda

private struct Beranda: View {
    @ObservedObject var perekam: Perekam
    var paksaSiap: Bool = false
    @State private var berdenyut = false

    private var lebarLayar: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.screen.bounds.width }
            .max() ?? 1080
    }

    var body: some View {
        VStack {
            Spacer()

            /*
             Ukuran huruf ditentukan dari lebar layar, bukan angka tetap.

             Angka tetap 78pt melebihi lebar iPad 9 (1080pt) dan kalimatnya
             terpotong di kedua ujung tanpa peringatan apa pun — SwiftUI tidak
             mengecilkan teks dengan sendirinya. minimumScaleFactor menjadi
             jaring pengaman terakhir untuk iPad yang lebih sempit lagi.
             */
            Text("Start to Whisper Your Wishes")
                .font(.system(size: min(78, lebarLayar * 0.062), weight: .semibold, design: .serif))
                .kerning(1.2)
                .lineLimit(1)
                .minimumScaleFactor(0.45)
                .multilineTextAlignment(.center)
                .foregroundStyle(sapuanEmas)
                .shadow(color: .unguTua.opacity(0.55), radius: 14, y: 5)
                .padding(.horizontal, 40)
                .scaleEffect(berdenyut ? 1.03 : 1.0)
                .animation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true), value: berdenyut)

            Text(paksaSiap || perekam.siap ? "Tap anywhere to begin" : "Preparing camera…")
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
        .overlay(alignment: .bottomTrailing) {
            /*
             Pemutar arah kamera, sengaja kecil dan redup.

             Sudut yang benar berbeda-beda menurut letak fisik kamera di tiap
             model iPad, dan menyimpulkannya dari orientasi antarmuka sudah
             dicoba berkali-kali dengan hasil yang tidak konsisten. Memutarnya
             sendiri sampai tegak menyelesaikannya dalam beberapa detik, sekali
             seumur pemasangan — nilainya diingat.

             Ditaruh di pojok dan dibuat samar supaya tamu tidak tergoda
             menyentuhnya, tetapi tetap bisa dijangkau petugas.
             */
            Button {
                perekam.putarBerikutnya()
            } label: {
                Text("⟳ \(Int(perekam.sudutSekarang))°")
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.18), in: Capsule())
            }
            .padding(18)
        }
    }
}

// MARK: - Kamera

/// Pratinjau kamera. Diselipkan dari UIKit karena SwiftUI belum punya padanannya.
private struct PratinjauKamera: UIViewRepresentable {
    let sesi: AVCaptureSession
    let sudut: CGFloat

    func makeUIView(context: Context) -> LapisanKamera {
        let v = LapisanKamera()
        v.lapisan.session = sesi
        v.lapisan.videoGravity = .resizeAspectFill
        aturPutaran(v)
        return v
    }

    func updateUIView(_ uiView: LapisanKamera, context: Context) {
        // Diulang di sini karena sambungan pratinjau kadang belum ada saat
        // makeUIView dipanggil — sesi masih menyala di antrean lain.
        aturPutaran(uiView)
    }

    private func aturPutaran(_ v: LapisanKamera) {
        guard let sambungan = v.lapisan.connection else { return }
        if sambungan.isVideoRotationAngleSupported(sudut) {
            sambungan.videoRotationAngle = sudut
        }
    }
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

/**
 Pemutar hasil rekaman.

 Berputar terus tanpa henti dan tanpa kendali apa pun. Tamu hanya perlu
 melihat hasilnya sekilas lalu menekan satu tombol; bilah pemutar, tombol
 jeda, dan penggeser waktu hanya menambah hal yang bisa ditekan keliru di
 depan antrean.
 */
private struct PemutarVideo: UIViewRepresentable {
    let berkas: URL
    let berjalan: Bool

    func makeUIView(context: Context) -> LapisanPemutar {
        let v = LapisanPemutar()
        v.pasang(berkas)
        return v
    }

    func updateUIView(_ uiView: LapisanPemutar, context: Context) {
        uiView.pasang(berkas)
        uiView.jalan(berjalan)
    }

    static func dismantleUIView(_ uiView: LapisanPemutar, coordinator: ()) {
        uiView.hentikan()
    }
}

private final class LapisanPemutar: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    private var lapisan: AVPlayerLayer { layer as! AVPlayerLayer }

    private var pemutar: AVQueuePlayer?
    private var pengulang: AVPlayerLooper?
    private var berkasSekarang: URL?

    func pasang(_ berkas: URL) {
        guard berkasSekarang != berkas else { return }
        berkasSekarang = berkas
        hentikan()

        let butir = AVPlayerItem(url: berkas)
        let antre = AVQueuePlayer()
        // Suara rekaman ikut terdengar saat ditinjau; tamu perlu tahu suaranya
        // benar-benar terekam, bukan hanya gambarnya.
        antre.isMuted = false
        pengulang = AVPlayerLooper(player: antre, templateItem: butir)
        lapisan.player = antre
        lapisan.videoGravity = .resizeAspect
        pemutar = antre
        antre.play()
    }

    func jalan(_ ya: Bool) {
        guard let pemutar else { return }
        if ya, pemutar.rate == 0 { pemutar.play() }
        if !ya, pemutar.rate != 0 { pemutar.pause() }
    }

    func hentikan() {
        pemutar?.pause()
        pengulang = nil
        pemutar = nil
        lapisan.player = nil
    }
}

private struct LayarKirim: View {
    @ObservedObject var perekam: Perekam
    @State private var mengirim = false

    @State private var berjalan = true

    /*
     HANYA versi berbingkai yang ditinjau.

     Sempat dipakai versi mentah sebagai pengisi selagi bingkainya disusun,
     supaya layar tidak kosong. Tetapi yang ditinjau tamu harus persis yang
     tersimpan — kalau ia menyetujui gambar tanpa bingkai lalu yang terkirim
     berbingkai, tinjauannya tidak berarti apa-apa.
     */
    private var siapDitinjau: Bool { perekam.berkasBerbingkai != nil }

    var body: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 28)

            if let berkas = perekam.berkasBerbingkai {
                ZStack {
                    PemutarVideo(berkas: berkas, berjalan: berjalan)

                    // Lambang putar/jeda hanya muncul saat dijeda, atau sekejap
                    // sesudah disentuh — supaya tidak menutupi wajah tamu.
                    if !berjalan {
                        Image(systemName: "play.fill")
                            .font(.system(size: 54))
                            .foregroundStyle(.white.opacity(0.9))
                            .shadow(color: .black.opacity(0.5), radius: 12)
                    }
                }
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .frame(maxHeight: 400)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.emas.opacity(0.55), lineWidth: 2))
                .shadow(color: .black.opacity(0.3), radius: 18, y: 8)
                .padding(.horizontal, 60)
                .contentShape(Rectangle())
                .onTapGesture { berjalan.toggle() }
            } else {
                // Selagi bingkai disusun. Tidak ada gambar sementara di sini,
                // dengan sengaja — lihat catatan di atas.
                ZStack {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(.black.opacity(0.25))
                    VStack(spacing: 14) {
                        ProgressView()
                            .controlSize(.large)
                            .tint(.white)
                        Text("Preparing your video…")
                            .font(.system(size: 20, weight: .medium, design: .serif))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .frame(maxHeight: 400)
                .padding(.horizontal, 60)
            }

            Text("Your Wishes Are Ready")
                .font(.system(size: 46, weight: .semibold, design: .serif))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 40)
                .padding(.top, 22)
                .foregroundStyle(sapuanEmas)
                .shadow(color: .unguTua.opacity(0.55), radius: 14, y: 5)

            Text(siapDitinjau
                 ? "Tap the video to pause · then send"
                 : "Adding the frame to your video…")
                .font(.system(size: 20, weight: .medium, design: .serif))
                .foregroundStyle(.white.opacity(0.82))
                .padding(.top, 10)

            /*
             Tombol tetap bisa ditekan selagi bingkai disusun.

             Penyusunannya hampir selalu selesai duluan; kalaupun belum,
             `kirim()` yang menunggu — bukan tamu yang dilarang menekan tombol
             yang jelas-jelas ada di depannya.
             */
            /*
             Tombol menunggu bingkainya selesai.

             Menekan Send sebelum itu berarti menyetujui sesuatu yang belum
             pernah dilihat — dan justru itu yang mau dihindari oleh layar ini.
             */
            Button {
                guard !mengirim, siapDitinjau else { return }
                mengirim = true
                berjalan = false
                perekam.kirim()
            } label: {
                Text(mengirim ? "Sending…" : "Send Your Wishes")
                    .font(.system(size: 32, weight: .bold, design: .serif))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(Color.unguTua)
                    .padding(.horizontal, 56)
                    .padding(.vertical, 20)
                    .background(sapuanEmas, in: Capsule())
                    .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
            }
            .disabled(mengirim || !siapDitinjau)
            .opacity(siapDitinjau ? 1 : 0.4)
            .padding(.top, 22)

            Spacer(minLength: 20)
        }
    }
}
