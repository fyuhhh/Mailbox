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

    /// Sudut yang sedang berlaku; dipantau tampilan agar pratinjau ikut berputar.
    @Published var sudutSekarang: CGFloat = Perekam.sudutTersimpan

    /// Rekaman mentah terakhir, di dalam folder Dokumen aplikasi.
    @Published private(set) var berkasTerakhir: URL?

    /// Salinan berbingkai. Nil selama penyusunannya belum selesai.
    @Published private(set) var berkasBerbingkai: URL?

    /// Benar selama bingkai sedang ditempelkan.
    @Published private(set) var sedangMenyusun = false

    let sesi = AVCaptureSession()
    private let keluaran = AVCaptureMovieFileOutput()
    private let antrean = DispatchQueue(label: "id.opsjobs.whisperwishes.kamera")

    /// Lama rekaman. Diubah di satu tempat ini saja.
    static let lamaRekamDetik = 15

    /// Baris diagnosis kecil di layar. Satu foto layar cukup untuk tahu
    /// keadaan izin, sesi, dan alurnya tanpa perlu menyambungkan Mac.
    @Published var diagnosa: String = "mulai"

    /// Sebab gangguan terakhir. Disimpan terpisah supaya tidak tertimpa oleh
    /// pesan kegagalan yang datang sesudahnya — justru sebab inilah yang dicari.
    private var sebabGangguan: String = "-"

    /// Keadaan sesi tepat sebelum perekaman dimulai.
    private var keadaanSebelumRekam: String = "-"

    /// Benar bila delegate melaporkan penulisan berkas sudah dimulai.
    fileprivate var mulaiMenulis: Bool {
        get { _mulaiMenulis }
        set { _mulaiMenulis = newValue }
    }
    private var _mulaiMenulis = false

    private var tugasHitung: Task<Void, Never>?
    private var tugasRekam: Task<Void, Never>?

    // MARK: - Penyiapan

    /*
     Sadap gangguan sesi.

     "Recording Stopped" yang muncul saat gagal merekam adalah
     AVErrorSessionWasInterrupted — pesan itu menyebut akibatnya, bukan
     sebabnya. Pemberitahuan di bawah membawa alasan sesungguhnya, dan tanpa
     mencatatnya tidak ada cara membedakan kamera direbut aplikasi lain,
     perangkat terkunci, atau aplikasi dipindah ke latar.
     */
    private func pasangPengawas() {
        let pusat = NotificationCenter.default

        pusat.addObserver(forName: .AVCaptureSessionWasInterrupted,
                          object: sesi, queue: .main) { [weak self] catatan in
            let kode = (catatan.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue ?? -1
            let sebab: String
            switch kode {
            case 1:  sebab = "perangkat audio dipakai aplikasi lain"
            case 2:  sebab = "perangkat video dipakai aplikasi lain"
            case 3:  sebab = "aplikasi tidak di depan (multitasking)"
            case 4:  sebab = "aplikasi berdampingan / Slide Over"
            case 5:  sebab = "kamera mati karena panas berlebih"
            default: sebab = "kode \(kode)"
            }
            Task { @MainActor in
                self?.sebabGangguan = sebab
                self?.diagnosa = "sesi terganggu: \(sebab)"
            }
        }

        pusat.addObserver(forName: .AVCaptureSessionRuntimeError,
                          object: sesi, queue: .main) { [weak self] catatan in
            let galat = catatan.userInfo?[AVCaptureSessionErrorKey] as? NSError
            Task { @MainActor in
                self?.diagnosa = "galat sesi: \(galat?.code ?? -1) \(galat?.localizedDescription ?? "")"
            }
        }

        pusat.addObserver(forName: .AVCaptureSessionInterruptionEnded,
                          object: sesi, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.diagnosa = "gangguan selesai" }
        }
    }

    func siapkan() async {
        pasangPengawas()
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

        /*
         Sudut putar dihitung DI SINI, di main actor.

         susunSesi berjalan di antrean kamera dan tidak boleh menyentuh
         UIApplication — orientasi antarmuka hanya boleh dibaca dari main actor.
         Jadi nilainya dititipkan, bukan diambil di sana.
         */
        let sudut = Self.sudutTersimpan

        antrean.async { [weak self] in
            guard let self else { return }

            /*
             Sesi audio TIDAK disentuh di sini.

             AVCaptureSession mengurusnya sendiri lewat
             automaticallyConfiguresApplicationAudioSession, dan menyetelnya
             dari luar berbarengan dengan itu justru menimbulkan bentrokan yang
             muncul sebagai gangguan sesi. Percobaan menyetelnya sendiri sudah
             dicoba dan tidak menghilangkan kegagalannya.
             */
            self.susunSesi(pakaiSuara: izinMikrofon, sudut: sudut)
            self.sesi.startRunning()
            let jalan = self.sesi.isRunning
            let masuk = self.sesi.inputs.count
            Task { @MainActor in
                self.siap = true
                self.sudutSekarang = sudut
                self.diagnosa = "orient:\(Self.namaOrientasi(Self.orientasiAktif())) sudut:\(Int(sudut))"
                    + " | kam:\(izinKamera ? "ya" : "tidak") mik:\(izinMikrofon ? "ya" : "tidak")"
                    + " masukan:\(masuk) sesi:\(jalan ? "jalan" : "mati")"
            }
        }
    }

    /**
     Sudut putar video, dihitung dari orientasi antarmuka.

     Sebelumnya diisi tetap 0. Angka itu berarti "ikuti orientasi bawaan sensor",
     dan sensor kamera iPad 9 berorientasi POTRET — sementara aplikasi ini
     terkunci lanskap. Hasilnya gambar kamera terputar 90 derajat terhadap
     tampilan aplikasinya.

     Orientasi antarmuka dipakai, bukan orientasi fisik perangkat: aplikasinya
     terkunci lanskap, jadi ke mana pun iPad dimiringkan, video harus tetap
     mengikuti apa yang dilihat tamu di layar.
     */
    /// Orientasi antarmuka yang sedang benar-benar aktif.
    static func orientasiAktif() -> UIInterfaceOrientation {
        /*
         Hanya scene yang AKTIF DI DEPAN yang dipercaya.

         `.first` atas seluruh connectedScenes bisa mengembalikan scene yang
         orientasinya masih `.unknown` beberapa saat sesudah aplikasi dibuka —
         dan nilai itu jatuh ke cabang bawaan, sehingga sudutnya dipasang
         berdasarkan tebakan, bukan keadaan sebenarnya.
         */
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let aktif = scenes.first(where: { $0.activationState == .foregroundActive }),
           aktif.interfaceOrientation != .unknown {
            return aktif.interfaceOrientation
        }
        return scenes.first(where: { $0.interfaceOrientation != .unknown })?.interfaceOrientation
            ?? .landscapeLeft
    }

    static func namaOrientasi(_ o: UIInterfaceOrientation) -> String {
        switch o {
        case .portrait:           return "potret"
        case .portraitUpsideDown: return "potret-balik"
        case .landscapeLeft:      return "lanskap-kiri"
        case .landscapeRight:     return "lanskap-kanan"
        default:                  return "tidak-diketahui"
        }
    }

    /// Kunci penyimpanan sudut pilihan petugas.
    private static let kunciSudut = "sudutPutarVideo"

    /**
     Sudut putar yang dipakai.

     Nilainya DISIMPAN, bukan disimpulkan. Menyimpulkannya dari orientasi
     antarmuka sudah dicoba empat kali dan hasilnya berbeda-beda antar
     percobaan — pemetaan sudut ke orientasi bergantung pada letak fisik kamera
     di tiap model iPad, dan tidak ada rumus yang benar untuk semuanya. Jauh
     lebih jujur membiarkan petugas memutarnya sekali sampai tegak, lalu
     mengingatnya.
     */
    static var sudutTersimpan: CGFloat {
        get {
            let d = UserDefaults.standard
            guard d.object(forKey: kunciSudut) != nil else { return sudutTerkaan() }
            return CGFloat(d.integer(forKey: kunciSudut))
        }
        set { UserDefaults.standard.set(Int(newValue), forKey: kunciSudut) }
    }

    /// Tebakan awal dari orientasi antarmuka. Hanya dipakai sebelum petugas
    /// memutarnya sendiri untuk pertama kali.
    static func sudutTerkaan() -> CGFloat {
        let orientasi = orientasiAktif()

        /*
         Pemetaan ini diperbaiki setelah diuji di iPad sungguhan.

         Percobaan pertama memakai landscapeRight = 0, dan hasilnya lanskap
         tetapi terbalik. Sudutnya diukur berlawanan arah jarum jam terhadap
         orientasi bawaan sensor, jadi kedua nilai lanskapnya bertukar tempat.
         */
        switch orientasi {
        case .portrait:           return 270
        case .portraitUpsideDown: return 90
        case .landscapeLeft:      return 0
        case .landscapeRight:     return 180
        default:                  return 180
        }
    }

    /// Putar 90 derajat ke pilihan berikutnya, dan pasang seketika.
    func putarBerikutnya() {
        let baru = (Self.sudutTersimpan + 90).truncatingRemainder(dividingBy: 360)
        Self.sudutTersimpan = baru
        sudutSekarang = baru
        terapkanPutaran()
    }

    /// Pasang sudut ke sambungan perekam. Aman dipanggil kapan saja selama
    /// tidak sedang merekam.
    func terapkanPutaran() {
        guard let sambungan = keluaran.connection(with: .video) else { return }
        let sudut = Self.sudutTersimpan
        if sambungan.isVideoRotationAngleSupported(sudut) {
            sambungan.videoRotationAngle = sudut
        }
    }

    /// Untuk uji alur di simulator, yang tidak punya kamera sama sekali.
    func paksaSiap() { siap = true }

    private func minta(_ jenis: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: jenis) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: jenis)
        default: return false
        }
    }

    private nonisolated func susunSesi(pakaiSuara: Bool, sudut: CGFloat) {
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
        /*
         Putaran dan cermin dipasang di sini, sekali, saat sesi disusun.

         Sebelumnya sudut putar diubah tepat sebelum startRecording. Mengubah
         susunan sambungan sesaat sebelum merekam membuat bingkai-bingkai
         pertama dibuang saat sambungan menata ulang dirinya — dan kalau semua
         bingkai terbuang, AVFoundation menutup berkasnya dengan
         AVErrorNoDataCaptured, bukan dengan galat yang menyebut sebabnya.
         */
        if let sambungan = keluaran.connection(with: .video) {
            if sambungan.isVideoMirroringSupported {
                sambungan.automaticallyAdjustsVideoMirroring = false
                sambungan.isVideoMirrored = true
            }
            if sambungan.isVideoRotationAngleSupported(sudut) {
                sambungan.videoRotationAngle = sudut
            }
        }

        sesi.commitConfiguration()
    }

    // MARK: - Alur

    /*
     Hitung mundur memakai Task.sleep, BUKAN Timer.

     Timer yang dijadwalkan ke run loop hanya berdetak dalam mode `.default`.
     Selama jari masih menyentuh layar — dan selama sejumlah animasi UIKit
     berjalan — run loop berada di mode pelacakan, dan pewaktunya diam. Di
     simulator hal ini tidak pernah muncul karena sentuhannya disuntikkan
     seketika; di perangkat sungguhan, jari manusia menempel jauh lebih lama.
     Task.sleep tidak bergantung pada run loop sama sekali.
     */
    func mulai() {
        guard siap, tahap == .beranda else { return }
        tahap = .hitungMundur
        hitungMundur = 3

        tugasHitung?.cancel()
        tugasHitung = Task { @MainActor [weak self] in
            for angka in stride(from: 3, through: 1, by: -1) {
                guard let self, !Task.isCancelled else { return }
                self.hitungMundur = angka
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
            guard let self, !Task.isCancelled else { return }
            self.mulaiRekam()
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
        /*
         Sudut putar dipasang tepat sebelum merekam.

         Di dalam susunSesi, sambungan keluaran belum tentu ada — dan orientasi
         antarmuka belum tentu sudah ditetapkan sistem. Di sini keduanya sudah
         pasti.
         */
        let sambungan = keluaran.connection(with: .video)

        /*
         Keadaan tepat sebelum merekam dicatat.

         AVErrorNoDataCaptured berarti perekaman dimulai tetapi tidak ada
         bingkai yang masuk. Sebabnya selalu salah satu dari: sesi tidak
         berjalan, sambungan video tidak aktif, atau sambungannya tidak ada
         sama sekali. Tanpa mencatat ketiganya, ketiga kemungkinan itu terlihat
         persis sama dari luar.
         */
        mulaiMenulis = false
        keadaanSebelumRekam = "sesi:\(sesi.isRunning ? "jalan" : "MATI")"
            + " sambung:\(sambungan == nil ? "TIDAK ADA" : (sambungan!.isActive ? "aktif" : "TIDAK AKTIF"))"
            + " nyala:\(sambungan?.isEnabled == true ? "ya" : "tidak")"
            + " masuk:\(sesi.inputs.count) keluar:\(sesi.outputs.count)"
        diagnosa = "merekam… " + keadaanSebelumRekam

        /*
         maxRecordedDuration TIDAK dipakai lagi.

         Batas itu dicurigai ikut menutup berkas sebelum ada bingkai yang
         tertulis. Penghentian sekarang sepenuhnya dipegang pewaktu di bawah,
         yang memakai Task.sleep dan tidak bergantung pada run loop maupun pada
         perhitungan waktu di dalam AVFoundation.
         */
        keluaran.startRecording(to: berkas, recordingDelegate: self)

        tugasRekam?.cancel()
        tugasRekam = Task { @MainActor [weak self] in
            while let s = self, s.sisaDetik > 0, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let s2 = self, !Task.isCancelled else { return }
                s2.sisaDetik -= 1
            }
            guard let s = self, !Task.isCancelled else { return }
            if s.keluaran.isRecording { s.keluaran.stopRecording() }
        }
    }

    /**
     Tempelkan bingkai, sebagai berkas kedua.

     Dijalankan begitu perekaman berhenti — bukan saat tombol ditekan — supaya
     penyusunannya berjalan selagi tamu membaca layar "Send Your Wishes".
     Sesudah tiga puluh detik merekam, menahannya lagi belasan detik di depan
     tombol adalah cara yang bagus untuk menumpuk antrean.
     */
    private func susunBerbingkai(_ mentah: URL) {
        sedangMenyusun = true
        berkasBerbingkai = nil

        let tujuan = mentah.deletingPathExtension()
            .appendingPathExtension("frame")
            .appendingPathExtension("mov")

        Task {
            do {
                try await Bingkai.tempel(asal: mentah, tujuan: tujuan)
                self.berkasBerbingkai = tujuan
            } catch {
                // Rekaman mentahnya tetap ada dan tetap dikirim. Kehilangan
                // hiasan jauh lebih ringan daripada kehilangan ucapan tamu.
                print("[bingkai] gagal: \(error)")
                self.berkasBerbingkai = nil
            }
            self.sedangMenyusun = false
        }
    }

    /// Dipanggil tombol "Send Your Wishes".
    func kirim() {
        guard let mentah = berkasTerakhir else {
            kembaliKeAwal()
            return
        }

        /*
         Berkas mentahnya SUDAH tersimpan di folder Dokumen sejak perekaman
         berhenti. Penyalinan ke galeri di sini adalah cadangan kedua, dan
         kegagalannya tidak boleh menahan tamu berikutnya.
         */
        Task {
            // Tunggu penyusunan bingkai kalau memang belum selesai. Batasnya 40
            // detik: lebih lama dari itu berarti ada yang salah, dan menahan
            // tamu tanpa batas lebih buruk daripada kehilangan salinan hiasnya.
            var sabar = 0
            while sedangMenyusun && sabar < 80 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                sabar += 1
            }

            await salinKeGaleri(mentah)
            if let berbingkai = berkasBerbingkai {
                await salinKeGaleri(berbingkai)
            }
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
        tugasHitung?.cancel()
        tugasRekam?.cancel()
        sisaDetik = 0
        hitungMundur = 3
        tahap = .beranda
    }
}

// MARK: - Hasil perekaman

extension Perekam: AVCaptureFileOutputRecordingDelegate {

    /// Penanda bahwa AVFoundation benar-benar mulai menulis berkas. Kalau ini
    /// tidak pernah terpanggil, kegagalannya ada di pemanggilan startRecording
    /// itu sendiri, bukan pada aliran bingkainya.
    nonisolated func fileOutput(_ output: AVCaptureFileOutput,
                                didStartRecordingTo fileURL: URL,
                                from connections: [AVCaptureConnection]) {
        Task { @MainActor in
            self.mulaiMenulis = true
            self.diagnosa = "menulis… sambungan:\(connections.count)"
        }
    }

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
                self.susunBerbingkai(outputFileURL)
                self.tahap = .kirim
            } else {
                self.pesan = "Rekaman gagal. Coba lagi."
                let ns = error as NSError?
                self.diagnosa = "gagal \(ns?.code ?? 0) | mulaiTulis:\(self.mulaiMenulis ? "YA" : "TIDAK") | \(self.keadaanSebelumRekam)"
                    + " | sesudah:\(self.sesi.isRunning ? "jalan" : "MATI")"
                    + " | ganggu:\(self.sebabGangguan)"
                self.tahap = .beranda
            }
        }
    }
}
