import Foundation
import Security

final class PairingStore {
    private let service = "io.harnessdesktop.mobile.pairing"
    private let account = "active-desktop"

    func load() -> PairingProfile? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return PairingProfile.fromStoredData(data)
    }

    func save(_ profile: PairingProfile) throws {
        let data = try profile.storedData()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var created = query
            attributes.forEach { created[$0.key] = $0.value }
            let addStatus = SecItemAdd(created as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw PairingStoreError.keychain(addStatus) }
        } else if status != errSecSuccess {
            throw PairingStoreError.keychain(status)
        }
    }

    func forget() {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ] as CFDictionary)
    }
}

enum PairingStoreError: LocalizedError {
    case keychain(OSStatus)
    var errorDescription: String? {
        switch self { case .keychain(let status): return "无法安全保存配对信息（Keychain \(status)）。" }
    }
}
