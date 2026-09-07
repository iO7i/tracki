// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TrackiSDK",
    platforms: [
        .iOS(.v14),
        .macOS(.v11),
    ],
    products: [
        .library(name: "TrackiSDK", targets: ["TrackiSDK"]),
    ],
    targets: [
        .target(name: "TrackiSDK"),
        .testTarget(
            name: "TrackiSDKTests",
            dependencies: ["TrackiSDK"]
        ),
    ]
)
