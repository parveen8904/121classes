// swift-tools-version: 5.9
import PackageDescription

// Swift Package Manager definition for the OfflineClasses Capacitor plugin
// (secure offline download + AES decrypt-on-play). Using SPM avoids CocoaPods.
let package = Package(
    name: "OfflineClasses",
    platforms: [.iOS(.v13)],
    products: [
        .library(name: "OfflineClasses", targets: ["OfflineClassesPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.0.0")
    ],
    targets: [
        .target(
            name: "OfflineClassesPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/OfflineClassesPlugin"
        )
    ]
)
