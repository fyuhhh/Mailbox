import AVFoundation
import Photos
import SwiftUI

/// Keadaan yang bisa dilihat layar. Urutannya sama dengan urutan yang dilalui tamu.
enum Tahap {
    case beranda
    case hitungMundur
    case merekam
    case kirim
}

/**
 Perekam kamera depan.

 Seluruh kerja AVFoundation dikurung di sini supaya tampilannya tinggal
 menonton `tahap` dan `sisaDetik`. Sesi kamera dijalankan di antrean sendiri:
 `startRunning()` memblokir pemanggilnya selama beberapa ratus milidetik, dan
 di antrean utama itu terlihat sebagai layar yang membeku tepat saat tamu
 menekan tombol.
 */
@MainActor
final class Perekam: NSObject, ObservableObject {

    @Published var tahap: Tahap = .beranda
    @Published var sisaDetik: Int = 0
    @Published var hitungMundur: Int = 3
    @Published var pesan: String = ""
    @Published var siap: Bool = false

    /// Berkas hasil rekaman terakhir, di dalam folder Dokumen aplikasi.
    @Published private(set) var berkasTerakhir: URL?

    let sesi = AVCaptureSession()
    private let keluaran = AVCaptureMovieFileOutput()
    private let antrean = DispatchQueue(label: "id.opsjobs.whisperwishes.kamera")

    /// Lama rekaman. Diubah di satu tempat ini saja.
    static let lamaRekamDetik = 30

    private var jamHitung: Timer?
    private var jamRekam: Timer?

    // MARK: - Penyiapan

    func siapkan() async {
        let izinKamera = await minta(.video)
        let izinMikrofon = await minta(.audio)

        guard izinKamera else {
            pesan = "Izin kamera ditolak. Buka Settings › Whisper Wishes › Camera."
            return
        }
        if !izinMikrofon {
            // Rekaman tanpa suara masih jauh lebih baik daripada tidak merekam
            // sama sekali, jadi ini diberitahukan tetapi tidak menghentikan.
            pesan = "Mikrofon belum diizinkan — rekaman akan tanpa suara."
        }

        antrean.async { [weak self] in
            guard let self else { return }
            self.susunSesi(pakaiSuara: izinMikrofon)
            self.sesi.startRunning()
            Task { @MainActor in self.siap = true }
        }
    }

    private func minta(_ jenis: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: jenis) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: jenis)
        default: return false
        }
    }

    private nonisolated func susunSesi(pakaiSuara: Bool) {
        sesi.beginConfiguration()
        sesi.sessionPreset = .high

        /*
         Kamera DEPAN disebut secara tegas, bukan `.default(for: .video)`.

         Pemilihan bawaan mengembalikan kamera belakang di iPad, dan tamu yang
         berdiri di depan layar akan merekam ruangan di belakang perangkat —
         kesalahan yang baru ketahuan setelah videonya ditonton.
         */
        if let kamera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
           let masukan = try? AVCaptureDeviceInput(device: kamera),
           sesi.canAddInput(masukan) {
            sesi.addInput(masukan)
        }

        if pakaiSuara,
           let mik = AVCaptureDevice.default(for: .audio),
           let masukanSuara = try? AVCaptureDeviceInput(device: mik),
           sesi.canAddInput(masukanSuara) {
            sesi.addInput(masukanSuara)
        }

        if sesi.canAddOutput(keluaran) { sesi.addOutput(keluaran) }

        /*
         Cermin dinyalakan supaya hasilnya sama dengan yang dilihat tamu di layar.

         Tanpa ini, gerakan tangan di rekaman terbalik dari yang barusan ia
         lakukan, dan tulisan apa pun di kaosnya terbaca terbalik.
         */
        if let sambungan = keluaran.connection(with: .video) {
            if sambungan.isVideoMirroringSupported {
                sambungan.automaticallyAdjustsVideoMirroring = false
                sambungan.isVideoMirrored = true
            }
            if #available(iOS 17.0, *), sambungan.isVideoRotationAngleSupported(0) {
                sambungan.videoRotationAngle = 0     // lanskap, sesuai kunci orientasi aplikasi
            }
        }

        sesi.commitConfiguration()
    }

    // MARK: - Alur

    func mulai() {
        guard siap, tahap == .beranda else { return }
        tahap = .hitungMundur
        hitungMundur = 3

        jamHitung?.invalidate()
        jamHitung = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] jam in
            Task { @MainActor in
                guard let self else { return }
                self.hitungMundur -= 1
                if self.hitungMundur <= 0 {
                    jam.invalidate()
                    self.mulaiRekam()
                }
            }
        }
    }

    private func mulaiRekam() {
        let berkas = FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("wish-\(Int(Date().timeIntervalSince1970)).mov")

        tahap = .merekam
        sisaDetik = Self.lamaRekamDetik

        /*
         Batas waktu dipasang di perekamnya sendiri, bukan hanya di pewaktu layar.

         Pewaktu di layar bisa tertunda kalau aplikasi tersendat; batas di
         AVCaptureMovieFileOutput dijaga oleh sistem dan berhenti tepat waktu
         apa pun yang terjadi di lapisan atasnya.
         */
        keluaran.maxRecordedDuration = CMTime(seconds: Double(Self.lamaRekamDetik), preferredTimescale: 600)
        keluaran.startRecording(to: berkas, recordingDelegate: self)

        jamRekam?.invalidate()
        jamRekam = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] jam in
            Task { @MainActor in
                guard let self else { return }
                self.sisaDetik -= 1
                if self.sisaDetik <= 0 {
                    jam.invalidate()
                    if self.keluaran.isRecording { self.keluaran.stopRecording() }
                }
            }
        }
    }

    /// Dipanggil tombol "Send Your Wishes".
    func kirim() {
        guard let berkas = berkasTerakhir else {
            kembaliKeAwal()
            return
        }

        /*
         Berkasnya SUDAH tersimpan di folder Dokumen sejak perekaman berhenti.

         Penyalinan ke galeri di sini adalah cadangan kedua, dan kegagalannya
         tidak boleh menahan tamu berikutnya. Kalau izin galeri ditolak,
         rekamannya tetap utuh di dalam aplikasi dan bisa ditarik lewat kabel.
         */
        Task {
            await salinKeGaleri(berkas)
            kembaliKeAwal()
        }
    }

    private func salinKeGaleri(_ berkas: URL) async {
        let izin = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard izin == .authorized || izin == .limited else { return }
        try? await PHPhotoLibrary.shared().performChanges {
            PHAssetCreationRequest.forAsset().addResource(with: .video, fileURL: berkas, options: nil)
        }
    }

    private func kembaliKeAwal() {
        jamHitung?.invalidate()
        jamRekam?.invalidate()
        sisaDetik = 0
        hitungMundur = 3
        tahap = .beranda
    }
}

// MARK: - Hasil perekaman

extension Perekam: AVCaptureFileOutputRecordingDelegate {
    nonisolated func fileOutput(_ output: AVCaptureFileOutput,
                                didFinishRecordingTo outputFileURL: URL,
                                from connections: [AVCaptureConnection],
                                error: Error?) {
        Task { @MainActor in
            /*
             Galat "maxDurationReached" bukan kegagalan.

             AVFoundation melaporkannya lewat jalur galat yang sama dengan
             kerusakan sungguhan, padahal berkasnya utuh dan lengkap. Menganggap
             semua galat sebagai kegagalan berarti membuang setiap rekaman yang
             berhenti karena waktunya habis — yaitu hampir semuanya.
             */
            let kode = (error as NSError?)?.code
            let selesaiWajar = error == nil || kode == AVError.maximumDurationReached.rawValue

            if selesaiWajar, FileManager.default.fileExists(atPath: outputFileURL.path) {
                self.berkasTerakhir = outputFileURL
                self.tahap = .kirim
            } else {
                self.pesan = "Rekaman gagal. Coba lagi."
                self.tahap = .beranda
            }
        }
    }
}
