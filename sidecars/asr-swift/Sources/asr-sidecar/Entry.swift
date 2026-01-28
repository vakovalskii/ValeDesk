import AVFoundation
import CoreML
import FluidAudio
import Foundation

// --- Memory Helper ---
func reportMemoryUsage() -> UInt64 {
    var taskInfo = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
    let kerr: kern_return_t = withUnsafeMutablePointer(to: &taskInfo) {
        $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }

    if kerr == KERN_SUCCESS {
        return taskInfo.resident_size
    } else {
        return 0
    }
}
// ---------------------

private struct Globals {
    static let ndjsonLock = NSLock()
}

// CoreML / AVFoundation types are not annotated as Sendable, but we only pass immutable
// instances across concurrency domains.
extension AVAudioPCMBuffer: @unchecked @retroactive Sendable {}
extension MLModelConfiguration: @unchecked @retroactive Sendable {}

private struct CliConfig {
    let modelsDir: URL
    let computeUnits: MLComputeUnits?
}

private struct CliParseError: Error {
    let message: String
    let status: SidecarExit
}

private func parseArgs() throws -> CliConfig {
    var args = CommandLine.arguments.dropFirst()
    var modelsDir: String?
    var computeUnits: MLComputeUnits?

    func nextValue(for flag: String) -> String? {
        guard let next = args.first else { return nil }
        args = args.dropFirst()
        return next
    }

    while let arg = args.first {
        args = args.dropFirst()
        switch arg {
        case "--models-dir":
            modelsDir = nextValue(for: arg)
        case "--compute-units":
            guard let raw = nextValue(for: arg) else {
                throw CliParseError(message: "Missing value for --compute-units", status: .usage)
            }
            switch raw.lowercased() {
            case "ane":
                computeUnits = .cpuAndNeuralEngine
            case "cpu":
                computeUnits = .cpuOnly
            case "gpu":
                computeUnits = .cpuAndGPU
            default:
                throw CliParseError(
                    message: "Invalid --compute-units value: \(raw). Expected ane|cpu|gpu",
                    status: .usage
                )
            }
        case "--help", "-h":
            throw CliParseError(
                message:
                """
                Usage: asr-sidecar --models-dir <ABS_PATH> [--compute-units ane|cpu|gpu]

                stdin (NDJSON):
                  {"cmd":"init","config":{"sample_rate":16000,"mode":"file","model_key":"asr_tdt_v3"}}
                  {"cmd":"file","path":"<ABS_PATH_TO_WAV>"}

                  {"cmd":"init","config":{"sample_rate":16000,"mode":"mic","model_key":"asr_tdt_v3"}}
                  {"cmd":"mic_start","device_id":"default"}
                  {"cmd":"mic_stop"}
                """
                ,
                status: .usage
            )
        default:
            throw CliParseError(message: "Unknown argument: \(arg)", status: .usage)
        }
    }

    guard let modelsDir else { throw CliParseError(message: "Missing required --models-dir <ABS_PATH>", status: .usage) }
    guard modelsDir.hasPrefix("/") else { throw CliParseError(message: "--models-dir must be an absolute path", status: .usage) }
    return CliConfig(
        modelsDir: URL(fileURLWithPath: modelsDir).standardizedFileURL,
        computeUnits: computeUnits
    )
}

private enum SidecarExit: Int32 {
    case ok = 0
    case usage = 2
    case runtime = 1
}

private func writeNdjson(_ obj: [String: Any]) {
    Globals.ndjsonLock.lock()
    defer { Globals.ndjsonLock.unlock() }
    do {
        let data = try JSONSerialization.data(withJSONObject: obj, options: [])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    } catch {
        FileHandle.standardError.write(Data(("asr-sidecar: failed to write NDJSON: \(error)\n").utf8))
    }
}

private func emitLog(_ msg: String) {
    writeNdjson(["t": "log", "msg": msg])
}

private func emitErrorAndExit(code: String, msg: String, context: [String: Any], status: SidecarExit) -> Never {
    writeNdjson(["t": "error", "code": code, "msg": msg, "context": context])
    fflush(stdout)
    exit(status.rawValue)
}

private enum AsrMode: String {
    case file = "file"
    case mic = "mic"
}

private enum AsrEngine: String {
    case tdtV3 = "asr_tdt_v3"
    case eou160ms = "asr_eou_160ms"
}

private struct TimedSegment {
    let text: String
    let start: TimeInterval
    let end: TimeInterval
}

private func isSentenceBoundaryToken(_ token: String) -> Bool {
    let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.hasSuffix(".") || trimmed.hasSuffix("!") || trimmed.hasSuffix("?") || trimmed.hasSuffix("…")
}

private func segmentTokenTimings(_ timings: [TokenTiming]) -> [TimedSegment] {
    let sorted = timings.sorted { $0.startTime < $1.startTime }
    guard !sorted.isEmpty else { return [] }

    let gapThreshold: TimeInterval = 1.0
    let targetDuration: TimeInterval = 4.0
    let maxDuration: TimeInterval = 6.0
    let targetChars = 84

    var segments: [TimedSegment] = []
    var currentText = ""
    var segmentStart: TimeInterval? = nil
    var segmentEnd: TimeInterval = 0
    var prevEnd: TimeInterval? = nil

    func flushSegment() {
        guard let start = segmentStart else { return }
        let text = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let end = max(segmentEnd, start)
        segments.append(TimedSegment(text: text, start: start, end: end))
    }

    for timing in sorted {
        // Use token timings only when they look sane.
        guard
            timing.startTime.isFinite,
            timing.endTime.isFinite,
            timing.startTime >= 0,
            timing.endTime >= timing.startTime
        else { continue }

        if let prevEnd, segmentStart != nil {
            let gap = timing.startTime - prevEnd
            if gap > gapThreshold, !currentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                flushSegment()
                currentText = ""
                segmentStart = nil
                segmentEnd = 0
            }
        }

        if segmentStart == nil {
            segmentStart = timing.startTime
        }

        currentText += timing.token
        segmentEnd = timing.endTime
        prevEnd = timing.endTime

        guard let start = segmentStart else { continue }
        let duration = segmentEnd - start
        let textLen = currentText.count

        let boundary = isSentenceBoundaryToken(timing.token) && duration >= 1.2
        let shouldSplit =
            duration >= maxDuration
            || (duration >= targetDuration && (boundary || textLen >= targetChars))
            || textLen >= targetChars * 2

        if shouldSplit {
            flushSegment()
            currentText = ""
            segmentStart = nil
            segmentEnd = 0
        }
    }

    if segmentStart != nil {
        flushSegment()
    }

    return segments
}

private func audioDurationSeconds(_ url: URL) throws -> TimeInterval {
    let file = try AVAudioFile(forReading: url)
    let sampleRate = file.processingFormat.sampleRate
    guard sampleRate > 0 else {
        throw NSError(domain: "asr-sidecar", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid sample rate: \(sampleRate)"])
    }
    return TimeInterval(file.length) / sampleRate
}

private struct InboundCommand: Decodable {
    let cmd: String
    let config: InboundConfig?
    let path: String?
    let deviceId: String?

    enum CodingKeys: String, CodingKey {
        case cmd
        case config
        case path
        case deviceId = "device_id"
    }
}

private struct InboundConfig: Decodable {
    let sampleRate: Int?
    let mode: String?
    let modelKey: String?
    let eouDebounceMs: Int?

    enum CodingKeys: String, CodingKey {
        case sampleRate = "sample_rate"
        case mode
        case modelKey = "model_key"
        case eouDebounceMs = "eou_debounce_ms"
    }
}

private func parakeetEouModelsExist(at directory: URL) -> Bool {
    let required = ModelNames.ParakeetEOU.requiredModels
    return required.allSatisfy { name in
        FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path)
    }
}

private func requestMicrophoneAccess() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return true
    case .denied, .restricted:
        return false
    case .notDetermined:
        return await withCheckedContinuation { cont in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                cont.resume(returning: granted)
            }
        }
    @unknown default:
        return false
    }
}

private func copyPcmBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameCapacity) else { return nil }
    copy.frameLength = buffer.frameLength

    let frames = Int(buffer.frameLength)
    let channels = Int(buffer.format.channelCount)

    if let src = buffer.floatChannelData, let dst = copy.floatChannelData {
        for ch in 0..<channels {
            dst[ch].update(from: src[ch], count: frames)
        }
        return copy
    }

    if let src = buffer.int16ChannelData, let dst = copy.int16ChannelData {
        for ch in 0..<channels {
            dst[ch].update(from: src[ch], count: frames)
        }
        return copy
    }

    return nil
}

private func rmsLevel(_ buffer: AVAudioPCMBuffer) -> Double? {
    let frames = Int(buffer.frameLength)
    guard frames > 0 else { return nil }
    let channelsCount = Int(buffer.format.channelCount)
    guard channelsCount > 0 else { return nil }

    // Prefer float samples.
    if let channels = buffer.floatChannelData {
        var sum: Double = 0
        for ch in 0..<channelsCount {
            let chPtr = channels[ch]
            for i in 0..<frames {
                let x = Double(chPtr[i])
                sum += x * x
            }
        }
        return sqrt(sum / Double(frames * channelsCount))
    }

    // Fall back to int16.
    if let channels = buffer.int16ChannelData {
        var sum: Double = 0
        for ch in 0..<channelsCount {
            let chPtr = channels[ch]
            for i in 0..<frames {
                let x = Double(chPtr[i]) / Double(Int16.max)
                sum += x * x
            }
        }
        return sqrt(sum / Double(frames * channelsCount))
    }

    return nil
}

private func rmsLevelsPerChannel(_ buffer: AVAudioPCMBuffer) -> [Double]? {
    let frames = Int(buffer.frameLength)
    guard frames > 0 else { return nil }
    let channelsCount = Int(buffer.format.channelCount)
    guard channelsCount > 0 else { return nil }

    if let channels = buffer.floatChannelData {
        var levels: [Double] = []
        levels.reserveCapacity(channelsCount)
        for ch in 0..<channelsCount {
            let chPtr = channels[ch]
            var sum: Double = 0
            for i in 0..<frames {
                let x = Double(chPtr[i])
                sum += x * x
            }
            levels.append(sqrt(sum / Double(frames)))
        }
        return levels
    }

    if let channels = buffer.int16ChannelData {
        var levels: [Double] = []
        levels.reserveCapacity(channelsCount)
        for ch in 0..<channelsCount {
            let chPtr = channels[ch]
            var sum: Double = 0
            for i in 0..<frames {
                let x = Double(chPtr[i]) / Double(Int16.max)
                sum += x * x
            }
            levels.append(sqrt(sum / Double(frames)))
        }
        return levels
    }

    return nil
}

private func convertToFloat32Mono16k(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter, targetFormat: AVAudioFormat) throws -> AVAudioPCMBuffer {
    let inputRate = buffer.format.sampleRate
    let outputRate = targetFormat.sampleRate
    guard inputRate > 0, outputRate > 0 else {
        throw NSError(domain: "asr-sidecar", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid sample rate for conversion"])
    }

    let ratio = outputRate / inputRate
    let outCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outCapacity) else {
        throw NSError(domain: "asr-sidecar", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate output buffer for conversion"])
    }

    var error: NSError?
    let providedPtr = UnsafeMutablePointer<Bool>.allocate(capacity: 1)
    providedPtr.initialize(to: false)
    defer {
        providedPtr.deinitialize(count: 1)
        providedPtr.deallocate()
    }
    _ = converter.convert(to: out, error: &error) { _, outStatus in
        if providedPtr.pointee {
            outStatus.pointee = .noDataNow
            return nil
        }
        providedPtr.pointee = true
        outStatus.pointee = .haveData
        return buffer
    }

    if let error {
        throw error
    }
    return out
}

private func writeWavFloat32Mono(samples: [Float], sampleRate: Double, url: URL) throws {
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false) else {
        throw NSError(domain: "asr-sidecar", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create output audio format"])
    }

    let frameCount = AVAudioFrameCount(samples.count)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
        throw NSError(domain: "asr-sidecar", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate PCM buffer for WAV writing"])
    }
    buffer.frameLength = frameCount

    guard let dst = buffer.floatChannelData?[0] else {
        throw NSError(domain: "asr-sidecar", code: 1, userInfo: [NSLocalizedDescriptionKey: "No floatChannelData for WAV writing"])
    }

    samples.withUnsafeBufferPointer { ptr in
        if let base = ptr.baseAddress {
            dst.update(from: base, count: samples.count)
        }
    }

    let file = try AVAudioFile(forWriting: url, settings: format.settings)
    try file.write(from: buffer)
}

private final class TdtChunkTranscriber: @unchecked Sendable {
    private let manager: AsrManager

    init(manager: AsrManager) {
        self.manager = manager
    }

    func transcribeText(url: URL) async throws -> String {
        let result = try await manager.transcribe(url, source: .system)
        return result.text
    }
}

private func formatDebugString(_ format: AVAudioFormat) -> String {
    let common: String
    switch format.commonFormat {
    case .pcmFormatFloat32: common = "f32"
    case .pcmFormatFloat64: common = "f64"
    case .pcmFormatInt16: common = "s16"
    case .pcmFormatInt32: common = "s32"
    case .otherFormat: common = "other"
    @unknown default: common = "unknown"
    }

    return "sr=\(String(format: "%.1f", format.sampleRate))Hz ch=\(format.channelCount) fmt=\(common) interleaved=\(format.isInterleaved)"
}

@main
struct AsrSidecarMain {
    static func main() async {
        let cfg: CliConfig
        do {
            cfg = try parseArgs()
        } catch let err as CliParseError {
            // Usage goes to stdout as an error event so the parent process can surface it.
            emitErrorAndExit(
                code: "usage",
                msg: err.message,
                context: ["argv": CommandLine.arguments],
                status: err.status
            )
        } catch {
            emitErrorAndExit(
                code: "usage",
                msg: "Failed to parse CLI arguments",
                context: ["argv": CommandLine.arguments, "error": error.localizedDescription],
                status: .usage
            )
        }
        await run(cfg: cfg)
    }

    private static func run(cfg: CliConfig) async {
        let tdtRepoDir = cfg.modelsDir.appendingPathComponent("parakeet-tdt-0.6b-v3-coreml", isDirectory: true).standardizedFileURL
        let eouRepoDir = cfg.modelsDir
            .appendingPathComponent("parakeet-realtime-eou-120m-coreml", isDirectory: true)
            .appendingPathComponent("160ms", isDirectory: true)
            .standardizedFileURL

        emitLog("Starting asr-sidecar")
        emitLog("models_dir=\(cfg.modelsDir.path)")
        emitLog("tdt_repo_dir=\(tdtRepoDir.path)")
        emitLog("eou_repo_dir=\(eouRepoDir.path)")

        var initialized = false
        var mode: AsrMode?
        var engine: AsrEngine?

        var asrManager: AsrManager?
        var eouManager: StreamingEouAsrManager?

        var audioEngine: AVAudioEngine?
        var audioStreamContinuation: AsyncStream<AVAudioPCMBuffer>.Continuation?
        var processingTask: Task<Void, Never>?
        var isRecording = false

        var lastAudioLevelEmitAt: UInt64 = 0
        var didLogRmsUnavailable = false
        var lastRmsDebugLogAt: UInt64 = 0

        while let line = readLine(strippingNewline: true) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }

            let cmd: InboundCommand
            do {
                let data = Data(trimmed.utf8)
                cmd = try JSONDecoder().decode(InboundCommand.self, from: data)
            } catch {
                emitErrorAndExit(
                    code: "invalid_json",
                    msg: "Failed to parse stdin line as JSON command",
                    context: ["line": trimmed, "error": error.localizedDescription],
                    status: .runtime
                )
            }

            switch cmd.cmd {
            case "init":
                if initialized {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "init was already called",
                        context: [:],
                        status: .runtime
                    )
                }
                let sampleRate = cmd.config?.sampleRate
                guard sampleRate == 16000 else {
                    emitErrorAndExit(
                        code: "invalid_config",
                        msg: "Only sample_rate=16000 is supported",
                        context: ["sample_rate": sampleRate as Any],
                        status: .runtime
                    )
                }

                let rawMode = (cmd.config?.mode ?? AsrMode.file.rawValue).lowercased()
                guard let parsedMode = AsrMode(rawValue: rawMode) else {
                    emitErrorAndExit(
                        code: "invalid_config",
                        msg: "Invalid mode; expected file|mic",
                        context: ["mode": rawMode],
                        status: .runtime
                    )
                }
                mode = parsedMode

                let rawEngine = cmd.config?.modelKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                guard let parsedEngine = AsrEngine(rawValue: rawEngine) else {
                    emitErrorAndExit(
                        code: "invalid_config",
                        msg: "Invalid model_key; expected one of the supported engine keys",
                        context: ["model_key": rawEngine],
                        status: .runtime
                    )
                }
                engine = parsedEngine
                emitLog("asr_engine=\(parsedEngine.rawValue)")

                var mlConfig: MLModelConfiguration?
                if let units = cfg.computeUnits {
                    let c = MLModelConfiguration()
                    c.computeUnits = units
                    mlConfig = c
                }

                do {
                    switch (parsedMode, parsedEngine) {
                    case (.file, .tdtV3), (.mic, .tdtV3):
                        if !AsrModels.modelsExist(at: tdtRepoDir, version: .v3) {
                            emitErrorAndExit(
                                code: "model_not_ready",
                                msg: "ASR (TDT) models are not installed in the expected directory",
                                context: [
                                    "models_dir": cfg.modelsDir.path,
                                    "expected_repo_dir": tdtRepoDir.path,
                                    "expected_files": Array(AsrModels.requiredModelNames),
                                    "expected_vocab": ModelNames.ASR.vocabularyFile,
                                ],
                                status: .runtime
                            )
                        }

                        emitLog("Loading ASR models (TDT v3) from local directory…")
                        let models = try await AsrModels.load(from: tdtRepoDir, configuration: mlConfig, version: .v3)
                        let manager = AsrManager(config: ASRConfig(sampleRate: 16000))
                        try await manager.initialize(models: models)
                        asrManager = manager
                        initialized = true
                        emitLog(parsedMode == .file ? "ASR (file, TDT) ready" : "ASR (mic, TDT) ready")

                    case (.file, .eou160ms), (.mic, .eou160ms):
                        if !parakeetEouModelsExist(at: eouRepoDir) {
                            emitErrorAndExit(
                                code: "model_not_ready",
                                msg: "ASR (EOU) models are not installed in the expected directory",
                                context: [
                                    "models_dir": cfg.modelsDir.path,
                                    "expected_repo_dir": eouRepoDir.path,
                                    "expected_files": Array(ModelNames.ParakeetEOU.requiredModels),
                                ],
                                status: .runtime
                            )
                        }

                        let c = mlConfig ?? MLModelConfiguration()
                        let debounce = cmd.config?.eouDebounceMs ?? 1280
                        emitLog("Initializing StreamingEouAsrManager (chunk=160ms, debounce=\(debounce)ms)…")
                        let manager = StreamingEouAsrManager(configuration: c, chunkSize: .ms160, eouDebounceMs: debounce)

                        if parsedMode == .mic {
                            await manager.setPartialCallback { text in
                                writeNdjson(["t": "partial", "text": text])
                            }
                            await manager.setEouCallback { text in
                                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                                guard !trimmed.isEmpty else { return }
                                writeNdjson(["t": "final", "text": trimmed])
                                Task { await manager.reset() }
                            }
                        }

                        try await manager.loadModels(modelDir: eouRepoDir)
                        eouManager = manager
                        initialized = true
                        emitLog(parsedMode == .file ? "ASR (file, EOU) ready" : "ASR (mic, EOU) ready")
                    }
                } catch {
                    emitErrorAndExit(
                        code: "init_failed",
                        msg: "Failed to load CoreML models / initialize ASR",
                        context: [
                            "error": error.localizedDescription,
                            "models_dir": cfg.modelsDir.path,
                            "tdt_repo_dir": tdtRepoDir.path,
                            "eou_repo_dir": eouRepoDir.path,
                            "mode": mode?.rawValue as Any,
                            "engine": engine?.rawValue as Any,
                        ],
                        status: .runtime
                    )
                }

            case "file":
                guard initialized else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "Sidecar not initialized; call init first",
                        context: [:],
                        status: .runtime
                    )
                }
                guard mode == .file else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "file command is only supported in mode=file",
                        context: ["mode": mode?.rawValue as Any],
                        status: .runtime
                    )
                }
                guard let engine else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "Sidecar engine is not set; call init first",
                        context: [:],
                        status: .runtime
                    )
                }
                guard let path = cmd.path, !path.isEmpty else {
                    emitErrorAndExit(
                        code: "invalid_args",
                        msg: "Missing required field: path",
                        context: ["cmd": cmd.cmd],
                        status: .runtime
                    )
                }
                guard path.hasPrefix("/") else {
                    emitErrorAndExit(
                        code: "invalid_args",
                        msg: "path must be an absolute path",
                        context: ["path": path],
                        status: .runtime
                    )
                }
                let url = URL(fileURLWithPath: path).standardizedFileURL
                guard FileManager.default.fileExists(atPath: url.path) else {
                    emitErrorAndExit(
                        code: "file_not_found",
                        msg: "Input audio file does not exist",
                        context: ["path": url.path],
                        status: .runtime
                    )
                }

                do {
                    let duration: TimeInterval
                    do {
                        duration = try audioDurationSeconds(url)
                    } catch {
                        emitErrorAndExit(
                            code: "duration_failed",
                            msg: "Failed to compute audio duration",
                            context: ["path": url.path, "error": error.localizedDescription],
                            status: .runtime
                        )
                    }

                    switch engine {
                    case .tdtV3:
                        guard let manager = asrManager else {
                            emitErrorAndExit(
                                code: "invalid_state",
                                msg: "ASR (TDT) manager is not initialized",
                                context: [:],
                                status: .runtime
                            )
                        }

                        emitLog("Transcribing file (TDT): \(url.path)")
                        let result = try await manager.transcribe(url, source: .system)

                        let segments = segmentTokenTimings(result.tokenTimings ?? [])
                        if segments.isEmpty {
                            writeNdjson(["t": "final", "text": result.text, "start": 0.0, "end": duration])
                            fflush(stdout)
                            exit(SidecarExit.ok.rawValue)
                        }

                        var emitted = false
                        for seg in segments {
                            let start = max(0.0, seg.start)
                            let end = min(duration, seg.end)
                            guard end > start else { continue }
                            writeNdjson(["t": "final", "text": seg.text, "start": start, "end": end])
                            fflush(stdout)
                            emitted = true
                        }

                        if !emitted {
                            writeNdjson(["t": "final", "text": result.text, "start": 0.0, "end": duration])
                            fflush(stdout)
                        }

                        exit(SidecarExit.ok.rawValue)

                    case .eou160ms:
                        guard let manager = eouManager else {
                            emitErrorAndExit(
                                code: "invalid_state",
                                msg: "ASR (EOU) manager is not initialized",
                                context: [:],
                                status: .runtime
                            )
                        }

                        emitLog("Transcribing file (EOU): \(url.path)")
                        do {
                            let file = try AVAudioFile(forReading: url)
                            let bufferSize: AVAudioFrameCount = 1024
                            guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: bufferSize) else {
                                emitErrorAndExit(
                                    code: "io_failed",
                                    msg: "Failed to allocate audio buffer for file reading",
                                    context: ["path": url.path],
                                    status: .runtime
                                )
                            }

                            while true {
                                try file.read(into: buffer, frameCount: bufferSize)
                                if buffer.frameLength == 0 { break }
                                _ = try await manager.process(audioBuffer: buffer)
                            }
                        } catch {
                            emitErrorAndExit(
                                code: "file_read_failed",
                                msg: "Failed while reading audio file",
                                context: ["path": url.path, "error": error.localizedDescription],
                                status: .runtime
                            )
                        }

                        do {
                            let final = try await manager.finish().trimmingCharacters(in: .whitespacesAndNewlines)
                            if !final.isEmpty {
                                writeNdjson(["t": "final", "text": final, "start": 0.0, "end": duration])
                                fflush(stdout)
                            }
                            exit(SidecarExit.ok.rawValue)
                        } catch {
                            emitErrorAndExit(
                                code: "file_finish_failed",
                                msg: "Failed while finalizing file transcript",
                                context: ["path": url.path, "error": error.localizedDescription],
                                status: .runtime
                            )
                        }
                    }
                } catch {
                    emitErrorAndExit(
                        code: "transcribe_failed",
                        msg: "ASR transcription failed",
                        context: ["path": url.path, "error": error.localizedDescription],
                        status: .runtime
                    )
                }

            case "mic_start":
                guard initialized else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "Sidecar not initialized; call init first",
                        context: [:],
                        status: .runtime
                    )
                }
                guard mode == .mic else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "mic_start is only supported in mode=mic",
                        context: ["mode": mode?.rawValue as Any],
                        status: .runtime
                    )
                }
                guard let engine else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "Sidecar engine is not set; call init first",
                        context: [:],
                        status: .runtime
                    )
                }
                if isRecording {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "mic_start was already called",
                        context: [:],
                        status: .runtime
                    )
                }

                let granted = await requestMicrophoneAccess()
                guard granted else {
                    emitErrorAndExit(
                        code: "mic_permission_denied",
                        msg: "Microphone permission was denied",
                        context: [:],
                        status: .runtime
                    )
                }

                emitLog("Starting microphone capture…")

                let avEngine = AVAudioEngine()
                let input = avEngine.inputNode
                let format = input.inputFormat(forBus: 0)
                emitLog("Mic input format: \(formatDebugString(format))")

                if format.sampleRate <= 0 || format.channelCount == 0 {
                    emitErrorAndExit(
                        code: "mic_invalid_format",
                        msg: "Invalid microphone input format",
                        context: ["format": formatDebugString(format)],
                        status: .runtime
                    )
                }

                var cont: AsyncStream<AVAudioPCMBuffer>.Continuation?
                let stream = AsyncStream<AVAudioPCMBuffer> { continuation in
                    cont = continuation
                }
                audioStreamContinuation = cont

                switch engine {
                case .eou160ms:
                    guard let manager = eouManager else {
                        emitErrorAndExit(
                            code: "invalid_state",
                            msg: "ASR (EOU) manager is not initialized",
                            context: [:],
                            status: .runtime
                        )
                    }
                    processingTask = Task {
                        for await buf in stream {
                            do {
                                _ = try await manager.process(audioBuffer: buf)
                            } catch {
                                emitErrorAndExit(
                                    code: "mic_process_failed",
                                    msg: "Failed while processing microphone audio",
                                    context: ["error": error.localizedDescription],
                                    status: .runtime
                                )
                            }
                        }
                    }

                case .tdtV3:
                    guard let manager = asrManager else {
                        emitErrorAndExit(
                            code: "invalid_state",
                            msg: "ASR (TDT) manager is not initialized",
                            context: [:],
                            status: .runtime
                        )
                    }
                    let transcriber = TdtChunkTranscriber(manager: manager)

                    processingTask = Task {
                        let sampleRate: Double = 16000
                        guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false) else {
                            emitErrorAndExit(
                                code: "mic_invalid_format",
                                msg: "Failed to create target audio format (16kHz mono f32)",
                                context: [:],
                                status: .runtime
                            )
                        }

                        // VAD Initialization (required for dictation quality; fail fast if missing)
                        let vadModelUrl = cfg.modelsDir
                            .appendingPathComponent("silero-vad-coreml", isDirectory: true)
                            .appendingPathComponent("silero-vad-unified-256ms-v6.0.0.mlmodelc")
                        
                        var vad: VAD?
                        do {
                            vad = try VAD(modelUrl: vadModelUrl)
                            emitLog("VAD initialized (v6)")
                        } catch {
                            emitErrorAndExit(
                                code: "vad_init_failed",
                                msg: "Failed to load VAD CoreML model",
                                context: ["expected_path": vadModelUrl.path, "error": error.localizedDescription],
                                status: .runtime
                            )
                        }

                        // Sliding Window Configuration
                        let windowSizeSeconds: Double = 6.0
                        let stepSizeSeconds: Double = 0.5
                        let maxSamples = Int(sampleRate * windowSizeSeconds) // 96000
                        
                        var buffer: [Float] = []
                        buffer.reserveCapacity(maxSamples * 2) 
                        
                        // VAD State
                        var vadBuffer: [Float] = [] // Accumulate for 256ms chunks
                        let vadChunkSize = 4096 // 256ms at 16k? 16000 * 0.256 = 4096. Correct.
                        var consecutiveSilenceDuration: Double = 0
                        
                        var lastInferenceTime = Date()
                        var committedText = ""
                        var currentUnstableText = ""
                        
                        // Sanity Check State
                        var isFirstChkInPhrase = true

                        let tmpDir = FileManager.default.temporaryDirectory.appendingPathComponent("valedesk-asr-sidecar", isDirectory: true)
                        do {
                            try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
                        } catch {
                            emitErrorAndExit(
                                code: "io_failed",
                                msg: "Failed to create temporary directory",
                                context: ["path": tmpDir.path, "error": error.localizedDescription],
                                status: .runtime
                            )
                        }

                        var converter: AVAudioConverter?

                        // Pre-roll Configuration
                        let preRollDuration = 0.5 // Keep 0.5s of history
                        let preRollSamples = Int(sampleRate * preRollDuration) // 8000
                        var preRollBuffer: [Float] = [] // Simple Ring Buffer logic manually managed for now or just append/drop
                        // Actually, since we have a circular `buffer` for the window, we are already keeping history?
                        // No, `buffer` is the *active* recording buffer. When we clear it on Hard Cut, we lose history.
                        // We need a separate `preRollBuffer` that ALWAYS keeps the last 0.5s of audio, regardless of state.
                        
                        var isVadTriggered = false

                        for await buf in stream {
                            var urlToTranscribe: URL? = nil
                            var urlToFinalize: URL? = nil
                            
                            autoreleasepool {
                                // 1. Convert to 16kHz Mono Float32
                                do {
                                    if converter == nil {
                                        converter = AVAudioConverter(from: buf.format, to: targetFormat)
                                        if converter == nil {
                                            emitErrorAndExit(
                                                code: "mic_convert_failed",
                                                msg: "Failed to create AVAudioConverter for mic input",
                                                context: ["input_format": formatDebugString(buf.format)],
                                                status: .runtime
                                            )
                                        }
                                    }
                                    // Use local variable to avoid optional binding issues inside closure if needed,
                                    // but we can just use `converter!` since we checked.
                                    guard let c = converter else { return }
                                    
                                    let converted = try convertToFloat32Mono16k(buf, converter: c, targetFormat: targetFormat)
                                    guard let ch = converted.floatChannelData else { return }
                                    let frames = Int(converted.frameLength)
                                    let newSamples = UnsafeBufferPointer(start: ch[0], count: frames)
                                    
                                    // Update Pre-roll (Always)
                                    preRollBuffer.append(contentsOf: newSamples)
                                    if preRollBuffer.count > preRollSamples {
                                        preRollBuffer.removeFirst(preRollBuffer.count - preRollSamples)
                                    }
                                    
                                    // Append to Active Buffer
                                    buffer.append(contentsOf: newSamples)
                                    
                                    // Feed VAD Buffer
                                    if let v = vad {
                                        vadBuffer.append(contentsOf: newSamples)
                                        while vadBuffer.count >= vadChunkSize {
                                            let chunk = Array(vadBuffer.prefix(vadChunkSize))
                                            vadBuffer.removeFirst(vadChunkSize)
                                            
                                            do {
                                                let vadStart = Date()
                                                let prob = try v.update(samples: chunk)
                                                if -vadStart.timeIntervalSinceNow > 0.02 {
                                                   // emitLog("Slow VAD")
                                                }
                                                
                                                if prob < 0.3 {
                                                    consecutiveSilenceDuration += 0.256
                                                } else {
                                                    // Speech Detected!
                                                    if consecutiveSilenceDuration >= 0.2 { 
                                                        // Transition logic
                                                    }
                                                    
                                                    consecutiveSilenceDuration = 0
                                                    
                                                    if !isVadTriggered {
                                                        isVadTriggered = true
                                                        if buffer.count < preRollSamples + frames {
                                                             let validPreRoll = preRollBuffer.dropLast(frames) 
                                                             if !validPreRoll.isEmpty {
                                                                 buffer.insert(contentsOf: validPreRoll, at: 0)
                                                             }
                                                        }
                                                    }
                                                }
                                                
                                        // Hard Cut Logic
                                        if consecutiveSilenceDuration > 0.6 {
                                            isVadTriggered = false
                                            
                                            if !buffer.isEmpty { // Always finalize if buffer has content
                                                // 1. Final Transcribe
                                                // Sync transcribe set up
                                                if buffer.count > 0 {
                                                    let uuid = UUID().uuidString
                                                    let url = tmpDir.appendingPathComponent("final-\(uuid).wav")
                                                    do {
                                                        try writeWavFloat32Mono(samples: buffer, sampleRate: sampleRate, url: url)
                                                        // DEFER ASYNC WORK
                                                        urlToFinalize = url
                                                    } catch {
                                                        emitLog("HardCut Write Failed: \(error)")
                                                    }
                                                }
                                                
                                                // 2. Clear State Immediately
                                                // We must clear state so next VAD cycle starts fresh.
                                                // But we keep 'committedText' to append to it later.
                                                currentUnstableText = ""
                                                buffer.removeAll()
                                                vadBuffer.removeAll()
                                                v.reset()
                                                consecutiveSilenceDuration = 0
                                                // isFirstChkInPhrase will be reset after finalize
                                                
                                                emitLog("VAD: Silence detected (Hard cut applied)")
                                            }
                                        }
                                        
                                    } catch {
                                        emitLog("VAD Error: \(error)")
                                    }
                                }
                            }
                                    
                                } catch {
                                    emitErrorAndExit(
                                        code: "mic_convert_failed",
                                        msg: "Failed while converting mic audio to 16kHz mono",
                                        context: ["error": error.localizedDescription],
                                        status: .runtime
                                    )
                                }
                                
                                // 2. FIFO Buffer Maintenance (Max Size)
                                if buffer.count > maxSamples {
                                    let removeCount = buffer.count - maxSamples
                                    buffer.removeFirst(removeCount)
                                }
                                
                                // 3. Inference Timer
                                let now = Date()
                                if now.timeIntervalSince(lastInferenceTime) >= stepSizeSeconds {
                                    lastInferenceTime = now
                                    
                                    // Intentionally no memory logging here (avoid noisy NDJSON in production).
                                    
                                    // warm-up check:
                                    // How much audio do we have?
                                    // buffer is [Float]. at 16k, 0.8s = 12800 samples.
                                    if buffer.count < 12800 {
                                        // Too short, skip inference to avoid hallucinations
                                        return
                                    }
                                    
                                    var snapshot = buffer
                                    // ... padding logic ...
                                    if snapshot.count < maxSamples {
                                        let paddingNeeds = maxSamples - snapshot.count
                                        let padding = [Float](repeating: 0.0, count: paddingNeeds)
                                        snapshot.insert(contentsOf: padding, at: 0)
                                    }
                                    
                                    let uuid = UUID().uuidString
                                    let url = tmpDir.appendingPathComponent("window-\(uuid).wav")
                                    do {
                                        try writeWavFloat32Mono(samples: snapshot, sampleRate: sampleRate, url: url)
                                        urlToTranscribe = url
                                    } catch {
                                        emitErrorAndExit(
                                            code: "io_failed",
                                            msg: "Failed to write wav window",
                                            context: ["error": error.localizedDescription],
                                            status: .runtime
                                        )
                                    }
                                }
                            } // End autoreleasepool
                            
                            // 4. Async Transcribe (Outside autoreleasepool)
                            // A. Finalization (High Priority)
                            if let url = urlToFinalize {
                                do {
                                    let infStart = Date()
                                    let candidate = try await transcriber.transcribeText(url: url)
                                        .trimmingCharacters(in: .whitespacesAndNewlines)
                                    _ = try? FileManager.default.removeItem(at: url)
                                    
                                    let dur = -infStart.timeIntervalSinceNow
                                    if dur > 0.5 { emitLog("HardCut Inference: \(String(format: "%.3f", dur))s") }
                                    
                                    if !candidate.isEmpty {
                                        if !Stitcher.fuzzyEndsWith(text: committedText, suffix: candidate) {
                                             let res = Stitcher.merge(committed: committedText, candidate: candidate)
                                             committedText = res.fullText + res.unstableText
                                        } else {
                                            emitLog("Skipped duplicate suffix: \(candidate)")
                                        }
                                    }
                                    
                                    if !committedText.isEmpty {
                                        writeNdjson([
                                            "t": "partial",
                                            "text": committedText,
                                            "unstable": ""
                                        ])
                                    }
                                    
                                    isFirstChkInPhrase = true
                                    
                                } catch {
                                    emitLog("HardCut Transcribe Failed: \(error)")
                                }
                            }
                            // B. Sliding Window (Only if not finalized)
                            else if let url = urlToTranscribe {
                                do {
                                    let infStart = Date()
                                    let candidateRaw = try await transcriber.transcribeText(url: url)
                                    let candidate = candidateRaw.trimmingCharacters(in: .whitespacesAndNewlines)
                                    
                                    let dur = -infStart.timeIntervalSinceNow
                                    if dur > 0.45 {
                                        emitLog("Slow Inference: \(String(format: "%.3f", dur))s")
                                    }
                                    
                                    // Sanity Check for the very first transcription of a phrase
                                    if isFirstChkInPhrase && !candidate.isEmpty {
                                        if !Stitcher.isSanityCheckPassed(candidate) {
                                            emitLog("Sanity Check Failed: Ignored '\(candidate)'")
                                            // Don't commit, don't show.
                                            // Wait for next longer buffer.
                                            _ = try? FileManager.default.removeItem(at: url)
                                            continue 
                                        }
                                        // Passed
                                        isFirstChkInPhrase = false
                                    }
                                    
                                    let result = Stitcher.merge(committed: committedText, candidate: candidate)
                                    currentUnstableText = result.unstableText
                                    
                                    // Always emit partials if changed
                                    if result.fullText != committedText || !result.unstableText.isEmpty {
                                        if result.fullText != committedText {
                                            committedText = result.fullText
                                        }
                                        writeNdjson([
                                            "t": "partial", 
                                            "text": committedText, 
                                            "unstable": result.unstableText
                                        ])
                                    }
                                } catch {
                                     emitErrorAndExit(
                                        code: "mic_transcribe_window_failed",
                                        msg: "Failed while transcribing microphone window",
                                        context: ["error": error.localizedDescription],
                                        status: .runtime
                                    )
                                }
                                
                                _ = try? FileManager.default.removeItem(at: url)
                            }
                        } // End for await stream

                        // --- FINALIZATION: Process any remaining audio in buffer on Stop ---
                        if !buffer.isEmpty {
                            let uuid = UUID().uuidString
                            let url = tmpDir.appendingPathComponent("final-stop-\(uuid).wav")
                            do {
                               try writeWavFloat32Mono(samples: buffer, sampleRate: sampleRate, url: url)
                               
                               let text = try await transcriber.transcribeText(url: url)
                                  .trimmingCharacters(in: .whitespacesAndNewlines)
                               _ = try? FileManager.default.removeItem(at: url)

                               if !text.isEmpty {
                                   // Sanity Check: If committedText is empty, this is a short phrase.
                                   // We apply sanity check to avoid hallucinations like "Thank you".
                                   if committedText.isEmpty && !Stitcher.isSanityCheckPassed(text) {
                                        emitLog("Sanity Check Failed on Stop: Ignored '\(text)'")
                                   } else {
                                        if !Stitcher.fuzzyEndsWith(text: committedText, suffix: text) {
                                             let res = Stitcher.merge(committed: committedText, candidate: text)
                                             committedText = res.fullText + res.unstableText
                                             
                                             writeNdjson([
                                                 "t": "partial",
                                                 "text": committedText,
                                                 "unstable": ""
                                             ])
                                        } else {
                                             emitLog("Skipped duplicate suffix on Stop: \(text)")
                                        }
                                   }
                               }
                            } catch {
                               emitLog("Stop Transcribe Failed: \(error)")
                            }
                        }
                    }
                }

                let bufferSize: AVAudioFrameCount = 1024
                input.installTap(onBus: 0, bufferSize: bufferSize, format: format) { buffer, _ in
                    guard let continuation = audioStreamContinuation else { return }
                    guard let copy = copyPcmBuffer(buffer) else { return }

                    if let level = rmsLevel(buffer) {
                        // Throttle to ~20Hz.
                        let now = DispatchTime.now().uptimeNanoseconds
                        if now - lastAudioLevelEmitAt >= 50_000_000 {
                            lastAudioLevelEmitAt = now
                            writeNdjson(["t": "audio_level", "level": level])
                        }

                        // Also log a compact summary once per second to help debug "no levels" issues.
                        if now - lastRmsDebugLogAt >= 1_000_000_000 {
                            lastRmsDebugLogAt = now
                            if let perCh = rmsLevelsPerChannel(buffer) {
                                let perChStr = perCh.map { String(format: "%.6f", $0) }.joined(separator: ",")
                                emitLog("Mic RMS per channel=[\(perChStr)] combined=\(String(format: "%.6f", level))")
                            } else {
                                emitLog("Mic RMS unavailable for format: \(formatDebugString(buffer.format))")
                            }
                        }
                    } else if !didLogRmsUnavailable {
                        didLogRmsUnavailable = true
                        emitLog("rmsLevel() returned nil for mic format: \(formatDebugString(buffer.format))")
                    }

                    continuation.yield(copy)
                }

                do {
                    avEngine.prepare()
                    try avEngine.start()
                } catch {
                    emitErrorAndExit(
                        code: "mic_start_failed",
                        msg: "Failed to start AVAudioEngine",
                        context: ["error": error.localizedDescription],
                        status: .runtime
                    )
                }

                audioEngine = avEngine
                isRecording = true
                if let requested = cmd.deviceId, requested != "default" {
                    emitLog("Note: device_id selection is not implemented yet; using system default input device (requested=\(requested))")
                }
                emitLog("Mic recording started (device_id=\(cmd.deviceId ?? "default"))")

            case "mic_stop":
                guard initialized else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "Sidecar not initialized; call init first",
                        context: [:],
                        status: .runtime
                    )
                }
                guard mode == .mic else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "mic_stop is only supported in mode=mic",
                        context: ["mode": mode?.rawValue as Any],
                        status: .runtime
                    )
                }
                guard let engine else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "Sidecar engine is not set; call init first",
                        context: [:],
                        status: .runtime
                    )
                }
                guard isRecording else {
                    emitErrorAndExit(
                        code: "invalid_state",
                        msg: "mic_start was not called",
                        context: [:],
                        status: .runtime
                    )
                }

                emitLog("Stopping microphone capture…")

                if let engine = audioEngine {
                    engine.inputNode.removeTap(onBus: 0)
                    engine.stop()
                }

                audioStreamContinuation?.finish()
                _ = await processingTask?.result

                switch engine {
                case .eou160ms:
                    guard let manager = eouManager else {
                        emitErrorAndExit(
                            code: "invalid_state",
                            msg: "ASR (EOU) manager is not initialized",
                            context: [:],
                            status: .runtime
                        )
                    }
                    do {
                        let final = try await manager.finish().trimmingCharacters(in: .whitespacesAndNewlines)
                        if !final.isEmpty {
                            writeNdjson(["t": "final", "text": final])
                        }
                    } catch {
                        emitErrorAndExit(
                            code: "mic_finish_failed",
                            msg: "Failed while finalizing microphone transcript",
                            context: ["error": error.localizedDescription],
                            status: .runtime
                        )
                    }

                case .tdtV3:
                    break
                }

                exit(SidecarExit.ok.rawValue)

            default:
                emitErrorAndExit(
                    code: "unknown_cmd",
                    msg: "Unknown cmd value",
                    context: ["cmd": cmd.cmd],
                    status: .runtime
                )
            }
        }

        emitErrorAndExit(
            code: "eof",
            msg: "stdin closed unexpectedly",
            context: ["initialized": initialized, "mode": mode?.rawValue as Any, "engine": engine?.rawValue as Any],
            status: .runtime
        )
    }
}

