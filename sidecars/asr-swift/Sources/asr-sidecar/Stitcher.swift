//
//  Stitcher.swift
//  asr-sidecar
//

import Foundation

struct StitchResult {
    let fullText: String
    let unstableText: String
}

struct Stitcher {
    /// Stitches the new candidate text onto the existing committed text by finding the optimal overlap.
    /// Uses a "Right-Most Pivot" strategy with Fuzzy Matching to handle phonetic variations.
    static func merge(committed: String, candidate: String) -> StitchResult {
        if committed.isEmpty {
            return StitchResult(fullText: candidate, unstableText: candidate)
        }
        if candidate.isEmpty {
            return StitchResult(fullText: committed, unstableText: "")
        }

        let committedWords = committed.split(separator: " ").map { String($0) }
        let candidateWords = candidate.split(separator: " ").map { String($0) }
        
        let cNorm = committedWords.map { normalize($0) }
        let nNorm = candidateWords.map { normalize($0) }

        // Limit search to the last N words.
        let tailSize = 50
        let cCount = cNorm.count
        let searchStartIndex = max(0, cCount - tailSize)
        let searchRange = searchStartIndex..<cCount
        
        let cTailNorm = Array(cNorm[searchRange])
        let maxLen = min(cTailNorm.count, nNorm.count)
        
        // Pivot Search with Fuzzy Matching
        for len in stride(from: maxLen, through: 1, by: -1) {
            let nPrefix = Array(nNorm[0..<len])
            
            // Search for nPrefix within cTailNorm allowing fuzzy matches
            if let matchIndexInTail = findFuzzyMatch(needle: nPrefix, haystack: cTailNorm, threshold: 0.25) {
                // Pivot found.
                let absoluteMatchIndex = searchStartIndex + matchIndexInTail
                
                // --- Capitalization Fix ---
                // Before stitching, check if we need to lowercase the join point.
                // We are keeping committedWords[0..<absoluteMatchIndex]
                // and appending candidateWords.
                
                // Check word purely BEFORE the cut point
                let prefix = Array(committedWords[0..<absoluteMatchIndex])
                
                // If there is a "previous word" in the committed text...
                if let lastCommitted = prefix.last {
                    // And if it serves as a sentence end...
                    if !isSentenceEnd(lastCommitted) {
                        // Then the FIRST word of candidate should arguably be lowercased
                        // IF it's not a proper noun.
                        // Simple heuristic: always lowercase unless we know better?
                        // Or just checking if candidate starts with capital.
                        // Let's force lowercase for the first word of candidate
                        // to avoid "Hello world. Hello world" -> "Hello world hello world"
                        // But "My name is John" -> "My name is john" (bad).
                        // Let's stick to the rule: "Fence" fix - if model hallucinated Caps in middle of sentence.
                        // We modify candidateWords[0] inline for the result.
                    }
                }
                
                // Construct Result
                var stitchedCandidate = candidateWords
                if let lastCommitted = prefix.last, !isSentenceEnd(lastCommitted), !stitchedCandidate.isEmpty {
                     // Attempt to lowercase first char
                     let first = stitchedCandidate[0]
                     let lower = first.prefix(1).lowercased() + first.dropFirst()
                     stitchedCandidate[0] = String(lower)
                }

                let full = (prefix + stitchedCandidate).joined(separator: " ")
                
                // Unstable is the part of Candidate after the matched overlap
                let unstableStartIndex = len 
                let unstableWords = candidateWords.dropFirst(unstableStartIndex) 
                let unstable = unstableWords.joined(separator: " ")
                
                return StitchResult(fullText: full, unstableText: unstable)
            }
        }
        
        // No overlap found. Append.
        // Check fence here too
        var toAppend = candidateWords
        if let last = committedWords.last, !isSentenceEnd(last), !toAppend.isEmpty {
             let first = toAppend[0]
             let lower = first.prefix(1).lowercased() + first.dropFirst()
             toAppend[0] = String(lower)
        }
        
        let full = committed + " " + toAppend.joined(separator: " ")
        return StitchResult(fullText: full, unstableText: candidate)
    }

    /// Finds the last occurrence of `needle` in `haystack` with fuzzy tolerance.
    /// Returns the start index in `haystack`.
    private static func findFuzzyMatch(needle: [String], haystack: [String], threshold: Double) -> Int? {
        guard !needle.isEmpty, haystack.count >= needle.count else { return nil }
        
        // Iterate backwards (Right-Most)
        for i in stride(from: haystack.count - needle.count, through: 0, by: -1) {
            let slice = Array(haystack[i..<(i + needle.count)])
            
            // Calculate total edit distance for the phrase
            // We sum levenshtein distances of words? Or check mismatch count?
            // "Exact match" logic used equality.
            // Fuzzy logic: count mismatches.
            
            var mismatches = 0
            for (w1, w2) in zip(needle, slice) {
                if w1 != w2 {
                    // Check levenshtein for short/long words?
                    // Or just strict string inequality?
                    // The prompt said: "allow 20-30% difference".
                    // Let's compute normalized Levenshtein for the pair.
                    let dist = levenshtein(w1, w2)
                    let maxLen = Double(max(w1.count, w2.count))
                    if maxLen > 0 {
                         let ratio = Double(dist) / maxLen
                         if ratio > 0.3 { // If word is > 30% different, it's a mismatch
                             mismatches += 1
                         }
                    }
                }
            }
            
            // If total mismatching words ratio is low enough
            let mismatchRatio = Double(mismatches) / Double(needle.count)
            if mismatchRatio <= threshold {
                return i
            }
        }
        return nil
    }
    
    private static func normalize(_ s: String) -> String {
        return s.lowercased().filter { $0.isLetter || $0.isNumber }
    }
    
    private static func isSentenceEnd(_ s: String) -> Bool {
        return s.hasSuffix(".") || s.hasSuffix("!") || s.hasSuffix("?")
    }

    // Standard Levenshtein
    private static func levenshtein(_ s1: String, _ s2: String) -> Int {
        let s1 = Array(s1)
        let s2 = Array(s2)
        let (m, n) = (s1.count, s2.count)
        
        var d = [[Int]](repeating: [Int](repeating: 0, count: n + 1), count: m + 1)
        
        for i in 0...m { d[i][0] = i }
        for j in 0...n { d[0][j] = j }
        
        for i in 1...m {
            for j in 1...n {
                let cost = (s1[i - 1] == s2[j - 1]) ? 0 : 1
                d[i][j] = min(
                    d[i - 1][j] + 1,       // deletion
                    d[i][j - 1] + 1,       // insertion
                    d[i - 1][j - 1] + cost // substitution
                )
            }
        }
        return d[m][n]
    }
    
    /// Checks if the text ends with the suffix, ignoring special characters and case.
    static func fuzzyEndsWith(text: String, suffix: String) -> Bool {
        let cleanText = normalize(text)
        let cleanSuffix = normalize(suffix)
        guard !cleanText.isEmpty, !cleanSuffix.isEmpty else { return false }
        return cleanText.hasSuffix(cleanSuffix)
    }
    
    /// Checks if the text seems to be a valid transcription start (anti-hallucination).
    /// Returns true if valid, false if it should be discarded.
    static func isSanityCheckPassed(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return false }
        
        // 1. Too short
        if trimmed.count < 4 { return true } // Allow short "Да", "Нет" but warn? 
        // Actually, "Hi" is 2 chars. "Да" is 2 chars.
        // Let's rely on Language check more.
        
        // 2. Blacklist
        let lower = trimmed.lowercased()
        let blacklist = [
            "thank you", "subtitles by", "mbc", "copyright", "provided by",
            "i'm going to", "you know", "bye"
        ]
        if blacklist.contains(where: { lower.hasPrefix($0) }) {
            return false
        }
        
        // 3. Language Heuristic (Optional):
        // If we expect Russian, but get pure ASCII English sentence...
        // But we might be speaking English. 
        // Let's stick to Blacklist + Buffering for now.
        
        return true
    }
}

