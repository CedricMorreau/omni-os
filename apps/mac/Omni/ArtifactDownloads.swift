import AppKit
import OmniKit
import SwiftUI

extension EnvironmentValues {
  @Entry var artifactDownloads: [Artifact] = []
}

enum ArtifactDownloads {
  static let scheme = "omni-artifact-download"

  static func url(_ a: Artifact) -> URL? { URL(string: "\(scheme)://artifact/\(a.id)") }

  static func artifact(for url: URL, in artifacts: [Artifact]) -> Artifact? {
    guard url.scheme == scheme, let id = Int(url.lastPathComponent) else { return nil }
    return artifacts.first { $0.id == id }
  }

  static func marker(for a: Artifact, font: NSFont) -> NSAttributedString? {
    guard let url = url(a) else { return nil }
    let label = "Download \(a.name)"
    let side = (font.pointSize * 0.95).rounded()
    let ink = NSColor(Tok.fg3)
    let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { rect in
      guard let cg = NSGraphicsContext.current?.cgContext, let d = BrandPaths.icons["download"] else { return false }
      cg.scaleBy(x: rect.width / 24, y: rect.height / 24)
      cg.addPath(SVGPath.cgPath(d))
      cg.setStrokeColor(ink.cgColor)
      cg.setLineWidth(2)
      cg.setLineCap(.round)
      cg.setLineJoin(.round)
      cg.strokePath()
      return true
    }
    image.accessibilityDescription = label
    let attachment = NSTextAttachment()
    attachment.image = image
    attachment.bounds = CGRect(x: 0, y: -0.14 * font.pointSize, width: side, height: side)
    let out = NSMutableAttributedString(string: "\u{2009}", attributes: [.font: font])
    let mark = NSMutableAttributedString(attachment: attachment)
    mark.addAttributes([.link: url, .toolTip: label, .cursor: NSCursor.pointingHand], range: NSRange(location: 0, length: mark.length))
    out.append(mark)
    return out
  }

  @MainActor static func save(_ a: Artifact, client: OmniClient?, store: ThreadStore?) {
    guard let client else { return }
    Task { @MainActor in
      do {
        let data = try await client.file(client.artifactURL(a, download: true))
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let name = DownloadName.free(a.name) { FileManager.default.fileExists(atPath: dir.appendingPathComponent($0).path) }
        try data.write(to: dir.appendingPathComponent(name), options: .withoutOverwriting)
        store?.say("Saved \(name) to Downloads")
      } catch let error as OmniAPIError {
        store?.say("Could not save \(a.name): \(error.message)")
      } catch {
        store?.say("Could not save \(a.name): \(error.localizedDescription)")
      }
    }
  }
}
