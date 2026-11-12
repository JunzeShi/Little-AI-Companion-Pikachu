import AppKit
import Foundation
import PDFKit
import ImageIO
import Vision

struct LocalDocument {
    let name: String
    let text: String
    let image: Data?
    let notice: String
    init(name: String, text: String, image: Data?, notice: String = "") {
        self.name = name; self.text = text; self.image = image; self.notice = notice
    }
}

enum LocalDocuments {
    static let supported = Set(["pdf", "txt", "md", "csv", "tsv", "rtf", "doc", "docx", "ppt", "pptx", "xlsx", "png", "jpg", "jpeg", "heic", "tif", "tiff", "bmp"])
    static func read(data: Data, name: String, ocrPageLimit: Int = 50) throws -> LocalDocument {
        let ext = (name as NSString).pathExtension.lowercased()
        guard supported.contains(ext) else { throw LocalAPIError.tool("Unsupported file. Choose a PDF, image, text, Word document, or PowerPoint presentation.") }
        guard data.count <= 20 * 1024 * 1024 else { throw LocalAPIError.tool("Choose a file smaller than 20 MB.") }
        if ["png", "jpg", "jpeg", "heic", "tif", "tiff", "bmp"].contains(ext) {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 1600, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary),
                  let jpeg = NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else { throw LocalAPIError.tool("That image couldn’t be opened.") }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            var notice = ""
            do { try VNImageRequestHandler(cgImage: cg).perform([request]) }
            catch { notice = "On-device text recognition was unavailable for this image; a vision model is needed to inspect it." }
            let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
            return LocalDocument(name: name, text: String(text.prefix(40000)), image: jpeg, notice: notice)
        }
        let text: String
        var notices: [String] = []
        if ext == "pdf" {
            guard let pdf = PDFDocument(data: data), !pdf.isLocked else { throw LocalAPIError.tool("That PDF couldn’t be opened; it may be locked.") }
            var sections: [String] = []
            var ocrCount = 0
            let ocrLimit = max(0, min(50, ocrPageLimit))
            var omittedScans = false
            var ocrFailed = false
            var hasPageText = false
            for index in 0..<min(pdf.pageCount, 200) {
                if sections.reduce(0, { $0 + $1.count }) >= 120_000 {
                    notices.append("Only part of this PDF was read; some later pages were omitted.")
                    break
                }
                guard let page = pdf.page(at: index) else { continue }
                var pageText = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if pageText.isEmpty, ocrCount < ocrLimit {
                    ocrCount += 1
                    let bounds = page.bounds(for: .mediaBox)
                    let scale = min(2, 1600 / max(1, max(bounds.width, bounds.height)))
                    let size = NSSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
                    let thumbnail = page.thumbnail(of: size, for: .mediaBox)
                    if let cg = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                        let request = VNRecognizeTextRequest()
                        request.recognitionLevel = .accurate
                        do {
                            try VNImageRequestHandler(cgImage: cg).perform([request])
                            pageText = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                        } catch { ocrFailed = true }
                    } else { ocrFailed = true }
                } else if pageText.isEmpty {
                    omittedScans = true
                    continue
                }
                if !pageText.isEmpty { hasPageText = true; sections.append("[Page \(index + 1)]\n\(pageText)") }
            }
            if pdf.pageCount > 200 { notices.append("Only the first 200 pages were read.") }
            if omittedScans { notices.append("Some scanned pages were omitted because on-device OCR is limited to \(ocrLimit) pages per file.") }
            if ocrFailed { notices.append("On-device text recognition failed for one or more scanned pages.") }
            if !hasPageText && ocrFailed { throw LocalAPIError.tool("On-device text recognition could not read this scanned PDF. Try again or use a PDF with selectable text.") }
            text = sections.joined(separator: "\n\n")
        } else if ["txt", "md", "csv", "tsv"].contains(ext) {
            guard let decoded = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) else { throw LocalAPIError.tool("The text file could not be decoded.") }
            text = decoded
        } else if ext == "pptx" {
            text = try PowerPointReader.extractPPTX(data)
        } else if ext == "ppt" {
            text = try PowerPointReader.extractPPT(data)
        } else if ext == "xlsx" {
            text = try PowerPointReader.extractXLSX(data)
        } else {
            let type: NSAttributedString.DocumentType = ext == "rtf" ? .rtf : (ext == "doc" ? .docFormat : .officeOpenXML)
            let attributed = try NSAttributedString(data: data, options: [.documentType: type], documentAttributes: nil)
            text = attributed.string
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw LocalAPIError.tool("No readable text was found. The document may contain only pictures or unsupported content.") }
        if ext == "xlsx" { notices.append("Spreadsheet cells use stored values; formatting, date display, images and live formula calculations are not interpreted.") }
        if ext == "ppt" { notices.append("This older PowerPoint file may contain incomplete slide boundaries or extra template text.") }
        if ext == "pptx", text.contains("[Only part of this presentation was read; some later slide content was omitted.]") {
            notices.append("Only part of this presentation was read; some later slide content was omitted.")
        }
        if ext == "xlsx", text.contains("[Only part of this spreadsheet was read; later cells or sheets were omitted.]") {
            notices.append("Only part of this spreadsheet was read; later cells or sheets were omitted.")
        }
        if text.count > 160_000 { notices.append("Only part of this document was read; later content was omitted.") }
        let bounded = String(text.prefix(160_000))
        return LocalDocument(name: name, text: bounded, image: nil, notice: notices.joined(separator: " "))
    }

    static func snippets(in document: LocalDocument, question: String, limit: Int = 12000) -> String {
        let terms = Set(question.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { $0.count >= 3 })
        let chunks = stride(from: 0, to: document.text.count, by: 1800).map { offset -> String in
            let start = document.text.index(document.text.startIndex, offsetBy: offset)
            let end = document.text.index(start, offsetBy: 1800, limitedBy: document.text.endIndex) ?? document.text.endIndex
            return String(document.text[start..<end])
        }
        let ranked = chunks.enumerated().map { item in
            (index: item.offset, text: item.element, score: terms.reduce(0) { score, term in score + (item.element.localizedCaseInsensitiveContains(term) ? 1 : 0) })
        }
        // Stable, simple keyword ranking; keep original order for tied chunks.
        let sorted = ranked.sorted { $0.score == $1.score ? $0.index < $1.index : $0.score > $1.score }
        let notice = document.notice.isEmpty ? "" : "[Reading limitations: \(document.notice)]\n"
        let allowance = max(0, limit - notice.count)
        return notice + String(sorted.prefix(max(1, limit / 1800)).map(\.text).joined(separator: "\n…\n").prefix(allowance))
    }
}

final class RegionSelectionView: NSView {
    var start: NSPoint?
    var current: NSPoint?
    var finish: ((NSRect?) -> Void)?
    override var acceptsFirstResponder: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.25).setFill()
        bounds.fill()
        if let start, let current {
            let rect = NSRect(x: min(start.x, current.x), y: min(start.y, current.y), width: abs(start.x-current.x), height: abs(start.y-current.y))
            NSColor.clear.setFill()
            rect.fill(using: .copy)
            NSColor.systemYellow.setStroke()
            let path = NSBezierPath(rect: rect)
            path.lineWidth = 2
            path.stroke()
        }
        let label = "Drag to select an area · Esc to cancel" as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 16, weight: .medium), .foregroundColor: NSColor.white, .backgroundColor: NSColor.black.withAlphaComponent(0.6)]
        label.draw(at: NSPoint(x: 24, y: bounds.height - 45), withAttributes: attrs)
    }
    override func mouseDown(with event: NSEvent) { start = convert(event.locationInWindow, from: nil); current = start; needsDisplay = true }
    override func mouseDragged(with event: NSEvent) { current = convert(event.locationInWindow, from: nil); needsDisplay = true }
    override func mouseUp(with event: NSEvent) {
        guard let start else { finish?(nil); return }
        let end = convert(event.locationInWindow, from: nil)
        let rect = NSRect(x: min(start.x,end.x), y: min(start.y,end.y), width: abs(start.x-end.x), height: abs(start.y-end.y))
        finish?(rect.width >= 8 && rect.height >= 8 ? rect : nil)
    }
    override func keyDown(with event: NSEvent) { if event.keyCode == 53 { finish?(nil) } else { super.keyDown(with: event) } }
}

@MainActor func selectScreenRegion(on screen: NSScreen) async -> NSRect? {
    await withCheckedContinuation { continuation in
        let panel = CompanionWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let view = RegionSelectionView(frame: NSRect(origin: .zero, size: screen.frame.size))
        panel.contentView = view
        view.finish = { rect in
            panel.orderOut(nil)
            view.finish = nil
            continuation.resume(returning: rect)
        }
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(view)
        NSApp.activate(ignoringOtherApps: true)
    }
}
