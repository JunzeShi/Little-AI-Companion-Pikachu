import Foundation
import Security

struct WebSearchSource {
    let title: String
    let url: String
    let snippet: String

    var bridgeValue: [String: String] { ["title": title, "url": url, "snippet": snippet] }
}

enum SearchFailure: LocalizedError {
    case unavailable(String)
    var errorDescription: String? {
        switch self { case .unavailable(let message): return message }
    }
}

enum SearchKeychain {
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.localcompanion.pet.search",
         kSecAttrAccount as String: "tavily"]
    }

    static func read() throws -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else {
            throw SearchFailure.unavailable("Couldn’t read the search key from this Mac’s Keychain.")
        }
        return String(data: data, encoding: .utf8)
    }

    // The settings screen only needs to know whether an item exists; fetching
    // its secret can trigger a Keychain prompt after an app update.
    static func hasSavedKey() -> Bool {
        var request = query
        request[kSecReturnAttributes as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var attributes: CFTypeRef?
        return SecItemCopyMatching(request as CFDictionary, &attributes) == errSecSuccess
    }

    static func save(_ key: String) throws {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("tvly-"), trimmed.count >= 12, trimmed.count <= 512,
              !trimmed.contains(where: \.isWhitespace) else {
            throw SearchFailure.unavailable("Enter your Tavily key beginning with tvly-.")
        }
        let attributes = [kSecValueData as String: Data(trimmed.utf8)]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            attributes.forEach { item[$0.key] = $0.value }
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw SearchFailure.unavailable("Couldn’t save the search key in this Mac’s Keychain.")
        }
    }
}

struct WebSearchResult {
    let sources: [WebSearchSource]
    let provider: String
    let cached: Bool
    let fetchedAt: Date
    let notice: String?
}

@MainActor final class WebSearchService {
    private struct CachedSearch {
        let result: WebSearchResult
        let expires: Date
    }
    private var cache: [String: CachedSearch] = [:]
    private let session: URLSession
    private let apiKey: () throws -> String?
    private let defaults: UserDefaults

    init(session: URLSession = .shared, defaults: UserDefaults = .standard,
         apiKey: @escaping () throws -> String? = SearchKeychain.read) {
        self.session = session
        self.defaults = defaults
        self.apiKey = apiKey
    }

    func clearCache() { cache.removeAll() }

    func search(query: String, fresh: Bool,
                progress: (String) -> Void) async throws -> WebSearchResult {
        let query = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(400))
        guard !query.isEmpty else { throw SearchFailure.unavailable("I couldn’t form a search query for that question.") }
        let cacheKey = "\(fresh):\(query.lowercased())"
        if let entry = cache[cacheKey], entry.expires > Date() {
            return WebSearchResult(sources: entry.result.sources, provider: entry.result.provider,
                                   cached: true, fetchedAt: entry.result.fetchedAt, notice: entry.result.notice)
        }
        var notice: String?
        // Keychain access can wait for a system prompt. Keep that wait off the
        // main thread so the pet and macOS authorization UI remain responsive.
        let getKey = apiKey
        let savedKey = try? await Task.detached(priority: .userInitiated) { try getKey() }.value
        if let key = savedKey, !key.isEmpty {
            progress("Searching the web…")
            do {
                let sources = try await tavily(query: query, key: key)
                return remember(sources, provider: "Tavily", key: cacheKey, fresh: fresh, notice: nil)
            } catch {
                try Task.checkCancellation()
                notice = error.localizedDescription
                progress("Trying another search source…")
            }
        } else {
            notice = "For more reliable search, add a free Tavily key in Settings."
            progress("Searching free web feeds…")
        }

        // Feed fallbacks need no account and do not open a browser or handle CAPTCHAs.
        // Unlike the supported API, these public feeds can change or be unavailable.
        let feeds = fresh ? ["Google News", "Bing"] : ["Bing", "Google News"]
        for provider in feeds {
            try Task.checkCancellation()
            do {
                let sources = try await feed(query: query, provider: provider, fresh: fresh)
                if !sources.isEmpty {
                    let fallbackNotice = [notice, "This answer uses \(provider) fallback results."]
                        .compactMap { $0 }
                        .joined(separator: " ")
                    return remember(sources, provider: provider, key: cacheKey, fresh: fresh,
                                    notice: fallbackNotice)
                }
            } catch { try Task.checkCancellation() }
        }
        throw SearchFailure.unavailable(notice.map { "I couldn’t retrieve usable web results. \($0)" }
            ?? "I couldn’t retrieve usable web results. Check your internet connection and try again.")
    }

    private func remember(_ sources: [WebSearchSource], provider: String, key: String,
                          fresh: Bool, notice: String?) -> WebSearchResult {
        let now = Date()
        let result = WebSearchResult(sources: Array(sources.prefix(5)), provider: provider,
                                     cached: false, fetchedAt: now, notice: notice)
        cache = cache.filter { $0.value.expires > now }
        if cache.count >= 64, let oldest = cache.min(by: { $0.value.expires < $1.value.expires })?.key {
            cache.removeValue(forKey: oldest)
        }
        cache[key] = CachedSearch(result: result, expires: now.addingTimeInterval(fresh ? 120 : 3600))
        return result
    }

    private func tavily(query: String, key: String) async throws -> [WebSearchSource] {
        let month = Calendar.current.dateComponents([.year, .month], from: Date())
        let meter = "tavily.basic.\(month.year ?? 0).\(month.month ?? 0)"
        let used = defaults.integer(forKey: meter)
        guard used < 1000 else {
            throw SearchFailure.unavailable("Pikachu’s 1,000-search monthly limit has been reached; it will reset next month.")
        }
        // Count attempts, including timeouts, so retries cannot silently exceed the local limit.
        defaults.set(used + 1, forKey: meter)
        var request = URLRequest(url: URL(string: "https://api.tavily.com/search")!, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "query": query, "search_depth": "basic", "auto_parameters": false,
            "max_results": 5, "topic": "general", "include_answer": false,
            "include_raw_content": false, "include_published_date": true
        ])
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 {
            throw SearchFailure.unavailable("Tavily rejected the saved key (HTTP 401). It may be incomplete or revoked; replace it in Settings with an active key from your Tavily dashboard.")
        }
        if status == 403 {
            throw SearchFailure.unavailable("Tavily denied the request (HTTP 403). Check your key and account access in Tavily; update the key in Settings if it was revoked.")
        }
        if status == 432 || status == 433 { throw SearchFailure.unavailable("The free Tavily credits have run out for now.") }
        if status == 429 { throw SearchFailure.unavailable("Tavily is temporarily busy. Try again in a moment.") }
        guard (200..<300).contains(status) else { throw SearchFailure.unavailable("The search service is temporarily unavailable.") }
        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = payload["results"] as? [[String: Any]] else {
            throw SearchFailure.unavailable("The search service returned an unreadable response.")
        }
        var seen = Set<String>()
        let sources = results.compactMap { item -> WebSearchSource? in
            guard let rawURL = item["url"] as? String, let url = SearchText.httpsURL(rawURL),
                  seen.insert(url).inserted, let title = item["title"] as? String,
                  let content = item["content"] as? String, !content.isEmpty else { return nil }
            let date = (item["published_date"] as? String).map { "Published: \($0). " } ?? ""
            return WebSearchSource(title: String(title.prefix(240)), url: url,
                                   snippet: date + String(content.prefix(1600)))
        }
        guard !sources.isEmpty else { throw SearchFailure.unavailable("The search service found no readable sources for that question.") }
        return Array(sources.prefix(5))
    }

    private func feed(query: String, provider: String, fresh: Bool) async throws -> [WebSearchSource] {
        var parts = URLComponents(string: provider == "Bing"
            ? "https://www.bing.com/search" : "https://news.google.com/rss/search")!
        parts.queryItems = provider == "Bing"
            ? [URLQueryItem(name: "q", value: query), URLQueryItem(name: "format", value: "rss")]
            : [URLQueryItem(name: "q", value: query + (fresh ? " when:2d" : "")),
               URLQueryItem(name: "hl", value: "en-US"), URLQueryItem(name: "gl", value: "US"),
               URLQueryItem(name: "ceid", value: "US:en")]
        var request = URLRequest(url: parts.url!, timeoutInterval: 8)
        request.setValue("application/rss+xml, application/xml, text/xml", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              data.count < 2_000_000 else { return [] }
        let parser = SearchFeedParser()
        let xml = XMLParser(data: data)
        xml.shouldResolveExternalEntities = false
        xml.delegate = parser
        guard xml.parse() else { return [] }
        return Array(parser.items.compactMap { item -> WebSearchSource? in
            guard let url = SearchText.httpsURL(item["link"] ?? "") else { return nil }
            let title = SearchText.clean(item["title"] ?? "")
            let description = SearchText.clean(item["description"] ?? "")
            guard SearchText.isRelevant(title + " " + description, query: query) else { return nil }
            let published = item["pubDate"].map { "Published: \($0). " } ?? ""
            return WebSearchSource(title: String(title.prefix(240)), url: url,
                                   snippet: published + String(description.prefix(1200)))
        }.prefix(5))
    }
}

private final class SearchFeedParser: NSObject, XMLParserDelegate {
    var items: [[String: String]] = []
    private var item: [String: String]?
    private var field = ""
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        if name == "item" { item = [:] }
        field = name
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if item != nil { item![field, default: ""] += string }
    }
    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        if let text = String(data: CDATABlock, encoding: .utf8) { self.parser(parser, foundCharacters: text) }
    }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        if name == "item", let item { items.append(item); self.item = nil }
        field = ""
    }
}

private enum SearchText {
    static func httpsURL(_ value: String) -> String? {
        guard var parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.scheme == "http" || parts.scheme == "https",
              parts.user == nil, parts.password == nil,
              host != "localhost", !host.hasSuffix(".local"), !host.hasPrefix("127."),
              !host.hasPrefix("10."), !host.hasPrefix("192.168."), host != "::1" else { return nil }
        parts.scheme = "https"
        return parts.url?.absoluteString
    }
    static func clean(_ value: String) -> String {
        var clean = value.replacingOccurrences(of: "<[^>]*>", with: " ", options: .regularExpression)
        for (entity, text) in ["&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " "] {
            clean = clean.replacingOccurrences(of: entity, with: text)
        }
        return clean.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
    static func isRelevant(_ text: String, query: String) -> Bool {
        let stop: Set<String> = ["what","when","where","which","with","that","this","have","does","there","they","today","current","latest","please","prices","price","search","find","about","tell","internet","online","the","are","for","how","can","you","and","web","now"]
        let words = query.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init).filter { $0.count > 2 && !stop.contains($0) }
        guard !words.isEmpty else { return false }
        let content = text.lowercased()
        return words.filter { content.contains($0) }.count >= min(2, words.count)
    }
}
