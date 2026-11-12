import Foundation

// Extracts slide text locally; it never opens the presentation in an office app.
enum PowerPointReader {
    private static let maxEntryBytes = 2 * 1024 * 1024

    static func extractPPTX(_ data: Data) throws -> String {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("little-companion-\(UUID().uuidString)", isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
        catch { throw LocalAPIError.tool("Could not prepare the presentation for local reading.") }
        defer { try? FileManager.default.removeItem(at: directory) }
        let archive = directory.appendingPathComponent("presentation.pptx")
        guard FileManager.default.createFile(atPath: archive.path, contents: data, attributes: [.posixPermissions: 0o600]) else { throw LocalAPIError.tool("Could not prepare the presentation for local reading.") }
        let listing = try unzip(["-Z1", archive.path], maxBytes: 1_000_000)
        guard let names = String(data: listing, encoding: .utf8)?.components(separatedBy: .newlines) else { throw LocalAPIError.tool("The presentation archive couldn’t be read.") }
        let slidePattern = #"^ppt/slides/slide[0-9]+\.xml$"#
        let slides = Set(names.filter { $0.range(of: slidePattern, options: .regularExpression) != nil })
        guard !slides.isEmpty else { throw LocalAPIError.tool("No PowerPoint slides were found. The file may be damaged or encrypted.") }
        func entry(_ name: String) throws -> Data { try unzip(["-p", archive.path, name], maxBytes: maxEntryBytes) }
        var ordered: [String] = []
        if names.contains("ppt/presentation.xml"), names.contains("ppt/_rels/presentation.xml.rels"),
           let document = try? entry("ppt/presentation.xml"), let relationships = try? entry("ppt/_rels/presentation.xml.rels") {
            let parser = PresentationRelations()
            if parser.readPresentation(document) && parser.readRelationships(relationships) {
                ordered = parser.orderedIDs.compactMap { parser.targets[$0] }.compactMap { target in
                    let clean = target.hasPrefix("/") ? String(target.dropFirst()) : "ppt/" + target
                    return slides.contains(clean) ? clean : nil
                }
            }
        }
        if ordered.isEmpty {
            ordered = slides.sorted { a, b in a.compare(b, options: .numeric) == .orderedAscending }
        }
        var sections: [String] = []
        var totalText = 0
        var totalXML = 0
        var truncated = false
        for (index, name) in ordered.prefix(200).enumerated() {
            if totalText >= 120_000 || totalXML >= 20 * 1024 * 1024 { truncated = true; break }
            let xml = try entry(name)
            totalXML += xml.count
            let parser = SlideTextParser()
            guard parser.parse(xml) else { throw LocalAPIError.tool("Slide \(index + 1) could not be read.") }
            if !parser.text.isEmpty {
                let remaining = max(0, 120_000 - totalText)
                let excerpt = String(parser.text.prefix(remaining))
                sections.append("[Slide \(index + 1)]\n\(excerpt)")
                totalText += excerpt.count
                if excerpt.count < parser.text.count { truncated = true; break }
            }
        }
        if ordered.count > 200 || truncated { sections.append("[Only part of this presentation was read; some later slide content was omitted.]") }
        return sections.joined(separator: "\n\n")
    }

    static func extractXLSX(_ data: Data) throws -> String {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("little-companion-\(UUID().uuidString)", isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
        catch { throw LocalAPIError.tool("Could not prepare the spreadsheet for local reading.") }
        defer { try? FileManager.default.removeItem(at: directory) }
        let archive = directory.appendingPathComponent("workbook.xlsx")
        guard FileManager.default.createFile(atPath: archive.path, contents: data, attributes: [.posixPermissions: 0o600]) else { throw LocalAPIError.tool("Could not prepare the spreadsheet for local reading.") }
        let listing = try unzip(["-Z1", archive.path], maxBytes: 1_000_000)
        guard let names = String(data: listing, encoding: .utf8)?.components(separatedBy: .newlines) else { throw LocalAPIError.tool("The spreadsheet archive couldn’t be read.") }
        let pattern = #"^xl/worksheets/sheet[0-9]+\.xml$"#
        let sheets = Set(names.filter { $0.range(of: pattern, options: .regularExpression) != nil })
        guard !sheets.isEmpty else { throw LocalAPIError.tool("No spreadsheet sheets were found. The file may be damaged or encrypted.") }
        func entry(_ name: String) throws -> Data { try unzip(["-p", archive.path, name], maxBytes: maxEntryBytes) }
        var shared: [String] = []
        if names.contains("xl/sharedStrings.xml") {
            let parser = SpreadsheetSharedStrings()
            guard parser.parse(try entry("xl/sharedStrings.xml")) else { throw LocalAPIError.tool("Spreadsheet text could not be read.") }
            shared = parser.values
        }
        var ordered: [(String, String)] = []
        if names.contains("xl/workbook.xml"), names.contains("xl/_rels/workbook.xml.rels"),
           let workbook = try? entry("xl/workbook.xml"), let relationships = try? entry("xl/_rels/workbook.xml.rels") {
            let parser = SpreadsheetWorkbook()
            if parser.parse(workbook) && parser.parse(relationships) {
                ordered = parser.sheets.compactMap { title, id in
                    guard let target = parser.targets[id] else { return nil }
                    let clean = target.hasPrefix("/") ? String(target.dropFirst()) : "xl/" + target
                    return sheets.contains(clean) ? (title, clean) : nil
                }
            }
        }
        if ordered.isEmpty { ordered = sheets.sorted { $0.compare($1, options: .numeric) == .orderedAscending }.enumerated().map { ("Sheet \($0.offset + 1)", $0.element) } }
        var sections: [String] = [], totalText = 0, totalXML = 0
        var truncated = false
        for (title, path) in ordered.prefix(100) {
            if totalText >= 120_000 || totalXML >= 20 * 1024 * 1024 { truncated = true; break }
            let xml = try entry(path); totalXML += xml.count
            let parser = SpreadsheetCells(shared: shared, limit: 120_000 - totalText)
            guard parser.parse(xml) else { throw LocalAPIError.tool("A spreadsheet sheet could not be read.") }
            if !parser.text.isEmpty { sections.append("[Sheet: \(title)]\n\(parser.text)"); totalText += parser.text.count }
            if parser.truncated { truncated = true; break }
        }
        if ordered.count > 100 || truncated { sections.append("[Only part of this spreadsheet was read; later cells or sheets were omitted.]") }
        return sections.joined(separator: "\n\n")
    }

    private static func unzip(_ arguments: [String], maxBytes: Int) throws -> Data {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { throw LocalAPIError.tool("Document extraction is unavailable on this Mac.") }
        // Presentations are untrusted files: bound output and do not let a damaged archive run indefinitely.
        DispatchQueue.global().asyncAfter(deadline: .now() + 15) {
            if process.isRunning { process.terminate() }
        }
        var result = Data()
        while true {
            let chunk = output.fileHandleForReading.readData(ofLength: 32768)
            if chunk.isEmpty { break }
            result.append(chunk)
            if result.count > maxBytes {
                if process.isRunning { process.terminate() }
                process.waitUntilExit()
                throw LocalAPIError.tool("A document section is too large to read safely.")
            }
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw LocalAPIError.tool("The file couldn’t be read; it may be damaged or encrypted.") }
        return result
    }

    static func extractPPT(_ data: Data) throws -> String {
        guard let stream = CompoundDocument(data).stream(named: "PowerPoint Document") else {
            throw LocalAPIError.tool("This older PowerPoint file could not be read. Save it as PPTX and try again.")
        }
        let collector = LegacyPowerPointText(stream)
        let text = collector.extract()
        guard !text.isEmpty else { throw LocalAPIError.tool("No readable slide text was found in this older PowerPoint file. Save it as PPTX and try again.") }
        return "[Text extracted from an older PowerPoint presentation; slide boundaries may be incomplete]\n" + text
    }
}

private final class SlideTextParser: NSObject, XMLParserDelegate {
    private var insideText = false
    private var current = ""
    private var paragraphs: [String] = []
    var text: String { paragraphs.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) }
    func parse(_ data: Data) -> Bool {
        let parser = XMLParser(data: data); parser.delegate = self; parser.shouldResolveExternalEntities = false
        return parser.parse()
    }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes attributeDict: [String: String] = [:]) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "t" { insideText = true }
        if local == "br" { current += "\n" }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { if insideText { current += string } }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "t" { insideText = false }
        if local == "p" {
            let value = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { paragraphs.append(value) }
            current = ""
        }
    }
}

private final class PresentationRelations: NSObject, XMLParserDelegate {
    var orderedIDs: [String] = []
    var targets: [String: String] = [:]
    func parse(_ data: Data) -> Bool { let parser = XMLParser(data: data); parser.delegate = self; parser.shouldResolveExternalEntities = false; return parser.parse() }
    func readPresentation(_ data: Data) -> Bool { parse(data) }
    func readRelationships(_ data: Data) -> Bool { parse(data) }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes attributeDict: [String: String] = [:]) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "sldId", let id = attributeDict.first(where: { $0.key.hasSuffix(":id") })?.value { orderedIDs.append(id) }
        if local == "Relationship", let id = attributeDict["Id"], let target = attributeDict["Target"], attributeDict["TargetMode"] != "External" { targets[id] = target }
    }
}

// Minimal, bounded Compound File Binary reader used for legacy .ppt text atoms.
private struct CompoundDocument {
    let data: Data
    init(_ data: Data) { self.data = data }
    private func u16(_ at: Int) -> Int? {
        guard at >= 0, at + 2 <= data.count else { return nil }
        return Int(data[at]) | (Int(data[at + 1]) << 8)
    }
    private func u32(_ at: Int) -> UInt32? {
        guard at >= 0, at + 4 <= data.count else { return nil }
        return UInt32(data[at]) | (UInt32(data[at+1]) << 8) | (UInt32(data[at+2]) << 16) | (UInt32(data[at+3]) << 24)
    }
    private func u64(_ at: Int) -> UInt64? {
        guard let low = u32(at), let high = u32(at+4) else { return nil }
        return UInt64(low) | (UInt64(high) << 32)
    }
    func stream(named name: String) -> Data? {
        guard data.count >= 512, Array(data.prefix(8)) == [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1],
              let shift = u16(30), shift == 9 || shift == 12, u16(32) == 6,
              let fatCountRaw = u32(44), let dirStart = u32(48), let cutoff = u32(56),
              let miniStart = u32(60), let miniCountRaw = u32(64), let difatStart = u32(68), let difatCountRaw = u32(72) else { return nil }
        let sectorSize = 1 << shift
        let maxSectors = data.count / sectorSize
        let fatCount = Int(fatCountRaw), difatCount = Int(difatCountRaw), miniCount = Int(miniCountRaw)
        guard maxSectors > 0, fatCount <= maxSectors, difatCount <= maxSectors, miniCount <= maxSectors else { return nil }
        func sector(_ id: UInt32) -> Data? {
            guard id < UInt32(maxSectors) else { return nil }
            let start = (Int(id) + 1) * sectorSize
            guard start >= 0, start + sectorSize <= data.count else { return nil }
            return data.subdata(in: start..<(start + sectorSize))
        }
        func word(_ bytes: Data, _ offset: Int) -> UInt32? {
            guard offset >= 0, offset + 4 <= bytes.count else { return nil }
            return UInt32(bytes[offset]) | (UInt32(bytes[offset+1]) << 8) | (UInt32(bytes[offset+2]) << 16) | (UInt32(bytes[offset+3]) << 24)
        }
        var fatIDs: [UInt32] = []
        for offset in stride(from: 76, to: 512, by: 4) { if let id = u32(offset), id < 0xFFFFFFFA { fatIDs.append(id) } }
        var nextDIFAT = difatStart
        var seenDIFAT = Set<UInt32>()
        for _ in 0..<difatCount {
            guard seenDIFAT.insert(nextDIFAT).inserted, let block = sector(nextDIFAT) else { return nil }
            for offset in stride(from: 0, to: sectorSize - 4, by: 4) { if let id = word(block, offset), id < 0xFFFFFFFA { fatIDs.append(id) } }
            guard let next = word(block, sectorSize - 4) else { return nil }; nextDIFAT = next
        }
        guard fatIDs.count >= fatCount else { return nil }
        var fat: [UInt32] = []
        for id in fatIDs.prefix(fatCount) {
            guard let block = sector(id) else { return nil }
            for offset in stride(from: 0, to: sectorSize, by: 4) { if let value = word(block, offset) { fat.append(value) } }
        }
        func chain(_ start: UInt32, maxBytes: Int) -> Data? {
            var result = Data(), current = start, seen = Set<UInt32>()
            while current != 0xFFFFFFFE {
                guard current < UInt32(fat.count), seen.insert(current).inserted, let block = sector(current), result.count + block.count <= maxBytes else { return nil }
                result.append(block); current = fat[Int(current)]
            }
            return result
        }
        guard let dir = chain(dirStart, maxBytes: min(data.count, 4 * 1024 * 1024)) else { return nil }
        struct Entry { let type: UInt8; let start: UInt32; let size: Int }
        var root: Entry?, target: Entry?
        for offset in stride(from: 0, to: dir.count - 127, by: 128) {
            let len = Int(dir[offset+64]) | (Int(dir[offset+65]) << 8)
            guard len >= 2, len <= 64, len % 2 == 0, let start = word(dir, offset+116), let lowSize = word(dir, offset+120), let highSize = word(dir, offset+124) else { continue }
            let size64 = UInt64(lowSize) | (UInt64(highSize) << 32)
            guard size64 <= UInt64(data.count), let entryName = String(data: dir.subdata(in: offset..<(offset+len-2)), encoding: .utf16LittleEndian) else { continue }
            let value = Entry(type: dir[offset+66], start: start, size: Int(size64))
            if value.type == 5 { root = value }
            if value.type == 2 && entryName == name { target = value }
        }
        guard let target, target.size > 0 else { return nil }
        if target.size >= Int(cutoff) {
            guard let result = chain(target.start, maxBytes: data.count), result.count >= target.size else { return nil }
            return Data(result.prefix(target.size))
        }
        guard let root, let miniStream = chain(root.start, maxBytes: data.count),
              let miniFatBytes = chain(miniStart, maxBytes: max(1, miniCount) * sectorSize) else { return nil }
        var miniFat: [UInt32] = []
        for offset in stride(from: 0, to: miniFatBytes.count, by: 4) { if let value = word(miniFatBytes, offset) { miniFat.append(value) } }
        var current = target.start, seen = Set<UInt32>(), result = Data()
        while current != 0xFFFFFFFE {
            guard current < UInt32(miniFat.count), seen.insert(current).inserted else { return nil }
            let offset = Int(current) * 64
            guard offset + 64 <= miniStream.count, result.count + 64 <= data.count else { return nil }
            result.append(miniStream.subdata(in: offset..<(offset+64)))
            current = miniFat[Int(current)]
        }
        guard result.count >= target.size else { return nil }
        return Data(result.prefix(target.size))
    }
}

private final class LegacyPowerPointText {
    private let stream: Data
    private var chunks: [String] = []
    private var totalCharacters = 0
    private var totalRecords = 0
    init(_ stream: Data) { self.stream = stream }
    private func u16(_ pos: Int) -> UInt16 { UInt16(stream[pos]) | (UInt16(stream[pos+1]) << 8) }
    private func u32(_ pos: Int) -> UInt32 { UInt32(stream[pos]) | (UInt32(stream[pos+1]) << 8) | (UInt32(stream[pos+2]) << 16) | (UInt32(stream[pos+3]) << 24) }
    func extract() -> String {
        walk(0, stream.count, depth: 0)
        return chunks.joined(separator: "\n\n")
    }
    private func walk(_ start: Int, _ end: Int, depth: Int) {
        guard depth < 24 else { return }
        var offset = start
        while offset + 8 <= end && totalRecords < 100_000 && totalCharacters < 160_000 {
            totalRecords += 1
            let version = u16(offset) & 0x000F, type = u16(offset + 2), length = Int(u32(offset + 4))
            let begin = offset + 8
            guard length <= end - begin else { break }
            let next = begin + length
            if version == 0x000F {
                walk(begin, next, depth: depth + 1)
            } else if (type == 4000 || type == 4008), length <= 1_000_000 {
                let data = stream.subdata(in: begin..<next)
                let text = type == 4000 ? String(data: data, encoding: .utf16LittleEndian) : (String(data: data, encoding: .windowsCP1252) ?? String(data: data, encoding: .isoLatin1))
                if let text {
                    let cleaned = text.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) || $0 == "\n" || $0 == "\r" || $0 == "\t" }.map(String.init).joined().trimmingCharacters(in: .whitespacesAndNewlines)
                    if !cleaned.isEmpty { chunks.append(cleaned); totalCharacters += cleaned.count }
                }
            }
            offset = next
        }
    }
}

private final class SpreadsheetWorkbook: NSObject, XMLParserDelegate {
    var sheets: [(String, String)] = []
    var targets: [String: String] = [:]
    func parse(_ data: Data) -> Bool { let parser = XMLParser(data: data); parser.delegate = self; parser.shouldResolveExternalEntities = false; return parser.parse() }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes attrs: [String: String] = [:]) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "sheet", let name = attrs["name"], let id = attrs.first(where: { $0.key.hasSuffix(":id") })?.value { sheets.append((name, id)) }
        if local == "Relationship", let id = attrs["Id"], let target = attrs["Target"], attrs["TargetMode"] != "External" { targets[id] = target }
    }
}

private final class SpreadsheetSharedStrings: NSObject, XMLParserDelegate {
    var values: [String] = []
    private var current = "", inItem = false, inText = false
    func parse(_ data: Data) -> Bool { let parser = XMLParser(data: data); parser.delegate = self; parser.shouldResolveExternalEntities = false; return parser.parse() }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes attrs: [String: String] = [:]) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "si" { inItem = true; current = "" }
        if inItem && local == "t" { inText = true }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { if inText && current.count < 100_000 { current += string } }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "t" { inText = false }
        if local == "si" { inItem = false; values.append(current) }
    }
}

private final class SpreadsheetCells: NSObject, XMLParserDelegate {
    private let shared: [String], limit: Int
    private var lines: [String] = [], chars = 0, cells = 0
    private var inCell = false, inValue = false, inText = false, inFormula = false
    private var value = "", inline = "", formula = "", reference = "", type = ""
    var truncated = false
    var text: String { lines.joined(separator: "\n") }
    init(shared: [String], limit: Int) { self.shared = shared; self.limit = limit }
    func parse(_ data: Data) -> Bool { let parser = XMLParser(data: data); parser.delegate = self; parser.shouldResolveExternalEntities = false; return parser.parse() }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes attrs: [String: String] = [:]) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "c" { inCell = true; value = ""; inline = ""; formula = ""; reference = attrs["r"] ?? ""; type = attrs["t"] ?? "" }
        if inCell && local == "v" { inValue = true }
        if inCell && local == "t" { inText = true }
        if inCell && local == "f" { inFormula = true }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inValue && value.count < 100_000 { value += string }
        if inText && inline.count < 100_000 { inline += string }
        if inFormula && formula.count < 100_000 { formula += string }
    }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        let local = elementName.split(separator: ":").last.map(String.init) ?? elementName
        if local == "v" { inValue = false }
        if local == "t" { inText = false }
        if local == "f" { inFormula = false }
        guard local == "c", inCell else { return }
        inCell = false
        cells += 1
        if cells > 20_000 || chars >= limit { truncated = true; return }
        var display = type == "inlineStr" ? inline : value
        if type == "s", let index = Int(value), shared.indices.contains(index) { display = shared[index] }
        if type == "b" { display = value == "1" ? "TRUE" : "FALSE" }
        if display.isEmpty && !formula.isEmpty { display = "Formula has no stored result: \(formula)" }
        if display.isEmpty { return }
        let line = "\(reference): \(display)"
        let remaining = max(0, limit - chars)
        let excerpt = String(line.prefix(remaining))
        if excerpt.count < line.count { truncated = true }
        lines.append(excerpt); chars += excerpt.count + 1
    }
}
