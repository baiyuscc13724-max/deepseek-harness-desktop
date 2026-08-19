import XCTest
@testable import HarnessMobile

final class MobileAppUpdateCheckerTests: XCTestCase {
    func testSelectsOnlyNewerAppStoreUpdate() throws {
        let data = Data("""
        {"schemaVersion":1,"platforms":{"ios":{"version":"1.0.21","appStoreUrl":"https://testflight.apple.com/join/HarnessTest","required":false}}}
        """.utf8)
        let update = try MobileAppUpdateChecker.parse(data: data, currentVersion: "1.0.20")
        XCTAssertEqual(update?.version, "1.0.21")
        XCTAssertEqual(update?.storeURL.host, "testflight.apple.com")
        XCTAssertNil(try MobileAppUpdateChecker.parse(data: data, currentVersion: "1.0.21"))
    }

    func testRejectsDirectIPAAndNonAppleStores() {
        let data = Data("""
        {"schemaVersion":1,"platforms":{"ios":{"version":"2.0.0","appStoreUrl":"https://updates.example/Harness.ipa","required":false}}}
        """.utf8)
        XCTAssertThrowsError(try MobileAppUpdateChecker.parse(data: data, currentVersion: "1.0.20"))
    }

    func testComparesNumericVersions() {
        XCTAssertEqual(MobileAppUpdateChecker.compare("1.10.0", "1.9.9"), .orderedDescending)
        XCTAssertEqual(MobileAppUpdateChecker.compare("1.2", "1.2.0"), .orderedSame)
    }
}
