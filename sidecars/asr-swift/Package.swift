// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "asr-swift",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "asr-sidecar", targets: ["asr-sidecar"])
    ],
    dependencies: [
        // Pinned for reproducible builds.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", revision: "b598f43ed4056765349f068b13d0bed8cdabde07")
    ],
    targets: [
        .executableTarget(
            name: "asr-sidecar",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio")
            ]
        )
    ]
)

