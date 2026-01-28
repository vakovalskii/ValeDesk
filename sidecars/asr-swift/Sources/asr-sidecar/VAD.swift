import CoreML
import Foundation

final class VAD {
    private let model: MLModel
    private let windowSize: Int
    
    // Dynamic input names
    private var inputName: String = "input"
    private var stateName: String = "state"
    private var srName: String = "sr"
    
    // State persistence
    private var state: MLMultiArray?
    
    init(modelUrl: URL, windowSize: Int = 512) throws {
        self.windowSize = windowSize
        
        let config = MLModelConfiguration()
        config.computeUnits = .cpuOnly // VAD is light, CPU is fine and low latency
        self.model = try MLModel(contentsOf: modelUrl, configuration: config)
        
        // Discover inputs
        let inputs = model.modelDescription.inputDescriptionsByName.keys
        // Simple heuristics for Silero
        if inputs.contains("input") { self.inputName = "input" }
        else if inputs.contains("speech") { self.inputName = "speech" }
        
        if inputs.contains("state") { self.stateName = "state" }
        
        if inputs.contains("sr") { self.srName = "sr" }
        
        // Initialize state (usually 2x1x128 for Silero v4/v5/v6 unified?)
        // Let's inspect the expected shape if possible, or start with zeros.
        if let stateDesc = model.modelDescription.inputDescriptionsByName[self.stateName],
           let constraint = stateDesc.multiArrayConstraint {
            _ = constraint.shape.map { $0.intValue }
            self.state = try? MLMultiArray(shape: constraint.shape, dataType: .float32)
            // Zero out
            if let s = self.state {
                let count = s.count
                let ptr = UnsafeMutablePointer<Float>(OpaquePointer(s.dataPointer))
                ptr.initialize(repeating: 0.0, count: count)
            }
        }
    }
    
    func reset() {
        // Reset state to zeros
        if let s = self.state {
            let count = s.count
            let ptr = UnsafeMutablePointer<Float>(OpaquePointer(s.dataPointer))
            ptr.initialize(repeating: 0.0, count: count)
        }
    }
    
    /// Process a chunk of audio.
    /// - Parameter samples: Float array of samples (16kHz). Must match window size roughly, or be chunked?
    ///   Silero usually expects strictly chunks of specific size (e.g. 512, 1024, 1536).
    ///   The coreml model I found said "256ms", which at 16k is 4096 samples.
    ///   If we pass smaller/larger, it might fail or resize.
    ///   Let's assume we pass whatever we get, but we need to buffer?
    ///   Actually, CoreML models usually enforce fixed input size.
    /// - Returns: Speech probability (0.0 - 1.0)
    func update(samples: [Float]) throws -> Float {
        // 1. Prepare Input
        // MLMultiArray from samples
        // Silero often takes (1, N)
        // Let's check constraint from model description at runtime?
        // For now assume [1, samples.count]
        
        let input: MLMultiArray
        do {
            input = try MLMultiArray(shape: [1, NSNumber(value: samples.count)], dataType: .float32)
        } catch {
             // Fallback/Retry logic?
             // Maybe it expects flat [N]?
             input = try MLMultiArray(shape: [NSNumber(value: samples.count)], dataType: .float32)
        }
        
        // Copy data
        let ptr = UnsafeMutablePointer<Float>(OpaquePointer(input.dataPointer))
        for (i, val) in samples.enumerated() {
            ptr[i] = val
        }
        
        // 2. Prepare Inputs Dict
        var inputs: [String: Any] = [
            self.inputName: input
        ]
        
        if let s = self.state {
            inputs[self.stateName] = s
        }
        
        if model.modelDescription.inputDescriptionsByName.keys.contains(self.srName) {
            inputs[self.srName] = Int64(16000)
        }
        
        // 3. Predict
        let provider = try MLDictionaryFeatureProvider(dictionary: inputs)
        let output = try model.prediction(from: provider)
        
        // 4. Update State (Recurrent)
        // Output usually contains 'state' (or 'stateN') and 'output' (prob)
        // Or output name might be "output"
        // And "state" output might come back with same name or "state_out"
        // We need to feed output state back to input state.
        
        // Discover output names
        let outputNames = output.featureNames
        // Probability
        var prob: Float = 0.0
        if let outName = outputNames.first(where: { $0 == "output" || $0 == "identity" || $0 == "probability" }),
           let outFeature = output.featureValue(for: outName)?.multiArrayValue {
             // Usually [1, 1] or [1]
             prob = outFeature[0].floatValue
        } else if let first = outputNames.first, let outFeature = output.featureValue(for: first)?.multiArrayValue {
            // Fallback: first output is likely prob if it's small?
            // Actually state is usually large.
            if outFeature.count == 1 {
                prob = outFeature[0].floatValue
            }
        }
        
        // State update
        // Find output that matches state shape or name
        if let stateOutName = outputNames.first(where: { $0.contains("state") || $0 == "hn" || $0 == "output_1" }),
           let stateOut = output.featureValue(for: stateOutName)?.multiArrayValue {
             self.state = stateOut
        }
        
        return prob
    }
}

