import Foundation

struct MobileAppUpdate: Equatable {
    let version: String
    let storeURL: URL
    let required: Bool
}

enum MobileAppUpdateChecker {
    private struct Manifest: Decodable {
        let schemaVersion: Int
        let platforms: Platforms
        struct Platforms: Decodable { let ios: IOS }
        struct IOS: Decodable {
            let version: String
            let appStoreUrl: String
            let required: Bool?
        }
    }

    static func check(manifestURL: URL, currentVersion: String, session: URLSession = .shared) async throws -> MobileAppUpdate? {
        guard manifestURL.scheme?.lowercased() == "https", manifestURL.user == nil, manifestURL.password == nil else {
            throw URLError(.unsupportedURL)
        }
        var request = URLRequest(url: manifestURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 256 * 1024 else {
            throw URLError(.badServerResponse)
        }
        return try parse(data: data, currentVersion: currentVersion)
    }

    static func parse(data: Data, currentVersion: String) throws -> MobileAppUpdate? {
        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        guard manifest.schemaVersion == 1,
              isNumericVersion(manifest.platforms.ios.version),
              let storeURL = URL(string: manifest.platforms.ios.appStoreUrl),
              isApprovedStoreURL(storeURL) else {
            throw URLError(.cannotParseResponse)
        }
        guard compare(manifest.platforms.ios.version, currentVersion) == .orderedDescending else { return nil }
        return MobileAppUpdate(
            version: manifest.platforms.ios.version,
            storeURL: storeURL,
            required: manifest.platforms.ios.required ?? false
        )
    }

    static func compare(_ left: String, _ right: String) -> ComparisonResult {
        let a = left.split(separator: ".").map { Int($0) ?? 0 }
        let b = right.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(a.count, b.count) {
            let av = index < a.count ? a[index] : 0
            let bv = index < b.count ? b[index] : 0
            if av < bv { return .orderedAscending }
            if av > bv { return .orderedDescending }
        }
        return .orderedSame
    }

    private static func isNumericVersion(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        return (2...4).contains(parts.count) && parts.allSatisfy { !$0.isEmpty && $0.allSatisfy(\.isNumber) }
    }

    private static func isApprovedStoreURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", url.user == nil, url.password == nil else { return false }
        return ["apps.apple.com", "testflight.apple.com"].contains(url.host?.lowercased() ?? "")
    }
}
