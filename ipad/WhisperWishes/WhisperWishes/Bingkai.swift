import AVFoundation
import UIKit

/**
 Menempelkan bingkai LED ke rekaman.

 Bingkainya TIDAK dibakar saat merekam. AVCaptureMovieFileOutput menulis
 langsung dari kamera ke berkas — jalur paling hemat tenaga yang ada di iOS,
 dan satu-satunya yang bisa dipercaya menulis tiga puluh detik penuh tanpa
 bingkai gambar yang terlewat. Menyisipkan komposisi di tengah jalur itu berarti
 menukar keandalan rekaman dengan hiasan.

 Jadi hiasannya ditempelkan sesudahnya, sebagai berkas KEDUA. Yang mentah tetap
 utuh apa adanya, dan keduanya berisi gambar dan suara yang persis sama.
 */
enum Bingkai {

    /// Ukuran keluaran. Sama dengan ukuran berkas bingkainya.
    static let ukuran = CGSize(width: 1920, height: 1080)

    enum Galat: Error {
        case tidakAdaVideo
        case gambarBingkaiHilang
        case eksporGagal(String)
    }

    /**
     Susun salinan berbingkai dari `asal`, tulis ke `tujuan`.

     Videonya diperbesar untuk MENGISI bingkai, bukan dimuat seluruhnya. Jendela
     tembus pandang di bingkai ini hanya setinggi 36% layar; kalau videonya
     dimuat utuh, wajah tamu menyusut jadi pita tipis dengan pita hitam di
     kiri-kanan. Mengisi membuat bagian tengah wajah jatuh tepat di jendela itu.
     */
    static func tempel(asal: URL, tujuan: URL) async throws {
        let aset = AVURLAsset(url: asal)

        guard let trekVideo = try await aset.loadTracks(withMediaType: .video).first else {
            throw Galat.tidakAdaVideo
        }
        guard let gambar = UIImage(named: "BingkaiLED")?.cgImage else {
            throw Galat.gambarBingkaiHilang
        }

        let durasi = try await aset.load(.duration)
        let ukuranAlami = try await trekVideo.load(.naturalSize)
        let ubahAlami = try await trekVideo.load(.preferredTransform)

        // Ukuran setelah putaran bawaan trek diperhitungkan. Tanpa ini, rekaman
        // yang metadatanya menyimpan putaran akan dihitung dengan sisi tertukar
        // dan hasilnya terpotong di tempat yang tidak masuk akal.
        let ukuranTampil = ukuranAlami.applying(ubahAlami)
        let lebar = abs(ukuranTampil.width)
        let tinggi = abs(ukuranTampil.height)

        let komposisi = AVMutableComposition()

        guard let trekTujuan = komposisi.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw Galat.tidakAdaVideo
        }
        try trekTujuan.insertTimeRange(CMTimeRange(start: .zero, duration: durasi),
                                       of: trekVideo, at: .zero)

        // Suara ikut disalin bila ada. Tidak adanya suara bukan alasan gagal —
        // izin mikrofon bisa saja ditolak, dan gambar tanpa suara tetap berguna.
        if let trekSuara = try await aset.loadTracks(withMediaType: .audio).first,
           let tujuanSuara = komposisi.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try? tujuanSuara.insertTimeRange(CMTimeRange(start: .zero, duration: durasi),
                                             of: trekSuara, at: .zero)
        }

        let skala = max(ukuran.width / lebar, ukuran.height / tinggi)   // isi penuh
        let geserX = (ukuran.width - lebar * skala) / 2
        let geserY = (ukuran.height - tinggi * skala) / 2

        let lapisanTrek = AVMutableVideoCompositionLayerInstruction(assetTrack: trekTujuan)
        lapisanTrek.setTransform(
            ubahAlami.concatenating(CGAffineTransform(scaleX: skala, y: skala))
                     .concatenating(CGAffineTransform(translationX: geserX, y: geserY)),
            at: .zero)

        let perintah = AVMutableVideoCompositionInstruction()
        perintah.timeRange = CMTimeRange(start: .zero, duration: durasi)
        perintah.layerInstructions = [lapisanTrek]

        let vk = AVMutableVideoComposition()
        vk.renderSize = ukuran
        vk.frameDuration = CMTime(value: 1, timescale: 30)
        vk.instructions = [perintah]

        /*
         Susunan lapisan untuk AVVideoCompositionCoreAnimationTool.

         `isGeometryFlipped` WAJIB dinyalakan di lapisan bingkainya. Core
         Animation memakai sumbu Y yang naik ke atas, sedangkan gambar disusun
         dari atas ke bawah — tanpa ini bingkainya tertempel terbalik, dengan
         logo ONE7ELEVEN di atas dan logo mitra di bawah.
         */
        let lapisanInduk = CALayer()
        lapisanInduk.frame = CGRect(origin: .zero, size: ukuran)

        let lapisanVideo = CALayer()
        lapisanVideo.frame = lapisanInduk.frame

        let lapisanBingkai = CALayer()
        lapisanBingkai.frame = lapisanInduk.frame
        lapisanBingkai.contents = gambar
        lapisanBingkai.contentsGravity = .resize
        lapisanBingkai.isGeometryFlipped = true

        lapisanInduk.addSublayer(lapisanVideo)
        lapisanInduk.addSublayer(lapisanBingkai)

        vk.animationTool = AVVideoCompositionCoreAnimationTool(
            postProcessingAsVideoLayer: lapisanVideo, in: lapisanInduk)

        guard let ekspor = AVAssetExportSession(asset: komposisi,
                                                presetName: AVAssetExportPreset1920x1080) else {
            throw Galat.eksporGagal("sesi ekspor tidak bisa dibuat")
        }
        ekspor.videoComposition = vk
        ekspor.outputFileType = .mov
        ekspor.outputURL = tujuan
        ekspor.shouldOptimizeForNetworkUse = true

        try? FileManager.default.removeItem(at: tujuan)

        if #available(iOS 18.0, *) {
            try await ekspor.export(to: tujuan, as: .mov)
        } else {
            await ekspor.export()
            if ekspor.status != .completed {
                throw Galat.eksporGagal(ekspor.error?.localizedDescription ?? "status \(ekspor.status.rawValue)")
            }
        }
    }
}
