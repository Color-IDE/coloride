// Common macOS visual recorder for Electron and native editors. No app DOM hooks.
import AppKit
import ApplicationServices
import CoreMedia
import CoreVideo
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
}
let arguments = CommandLine.arguments
if arguments.contains("--check") {
    emit(["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(),
          "clock": "CoreMedia host clock", "capture": "ScreenCaptureKit target window only"])
    exit(0)
}
func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
guard let pid = argument("--pid").flatMap(Int32.init), let output = argument("--output"),
      let crop = argument("--rect")?.split(separator: ",").compactMap({ Double($0) }), crop.count == 4,
      crop[0] >= 0, crop[1] >= 0, crop[2] > 0, crop[3] > 0 else {
    fputs("Usage: native-capture --check | --pid PID --output DIR --rect x,y,width,height [--seconds 30]\n", stderr)
    exit(2)
}
guard CGPreflightScreenCaptureAccess(), AXIsProcessTrusted() else {
    emit(["status": "blocked", "reason": "Screen Recording and Accessibility permission are required; no recording started."])
    exit(2)
}
let duration = argument("--seconds").flatMap(Double.init) ?? 30
let requestedWindow = argument("--window-id").flatMap(UInt32.init)
// A command-line process must initialize AppKit before ScreenCaptureKit asks
// WindowServer for window content. Permission preflight alone does not do this.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
struct Frame {
    let time: Double
    let data: Data
    let width: Int
    let height: Int
    let stride: Int
}
final class Recorder: NSObject, SCStreamOutput, @unchecked Sendable {
    var frames: [Frame] = []
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: raw) == .complete,
              let buffer = sample.imageBuffer else { return }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        let pixels = Data(bytes: base, count: stride * height)
        // Retain every frame timestamp while sharing unchanged pixel storage.
        // A long idle block must not accumulate gigabytes of identical frames.
        let retainedPixels = frames.last.flatMap { $0.data == pixels ? $0.data : nil } ?? pixels
        frames.append(Frame(time: sample.presentationTimeStamp.seconds,
                            data: retainedPixels, width: width, height: height, stride: stride))
    }
}
final class ClickLog: @unchecked Sendable {
    let pid: Int32
    let frame: CGRect
    var clicks: [[String: Any]] = []
    init(pid: Int32, frame: CGRect) { self.pid = pid; self.frame = frame }
}
Task { @MainActor in
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        let windows = content.windows.filter { $0.owningApplication?.processID == pid && $0.frame.height > 200 }
        guard requestedWindow != nil || windows.count == 1 else {
            emit(["status": "error", "error": "Ambiguous fixture windows; supply --window-id", "windows": windows.map {
                ["id": $0.windowID, "title": $0.title ?? "", "frame": [$0.frame.minX, $0.frame.minY, $0.frame.width, $0.frame.height]] as [String: Any]
            }]); exit(2)
        }
        guard let window = windows.filter({ requestedWindow == nil || $0.windowID == requestedWindow })
            .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
            throw NSError(domain: "benchmark", code: 1, userInfo: [NSLocalizedDescriptionKey: "No visible fixture window for the requested PID"])
        }
        guard crop[0] + crop[2] <= window.frame.width, crop[1] + crop[3] <= window.frame.height else {
            throw NSError(domain: "benchmark", code: 2, userInfo: [NSLocalizedDescriptionKey: "Editor crop is outside the fixture window"])
        }
        let log = ClickLog(pid: pid, frame: window.frame)
        let context = Unmanaged.passRetained(log).toOpaque()
        defer { Unmanaged<ClickLog>.fromOpaque(context).release() }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: CGEventMask(1 << CGEventType.leftMouseDown.rawValue), callback: { _, type, event, context in
                guard type == .leftMouseDown, let context else { return Unmanaged.passUnretained(event) }
                let log = Unmanaged<ClickLog>.fromOpaque(context).takeUnretainedValue()
                if NSWorkspace.shared.frontmostApplication?.processIdentifier == log.pid && log.frame.contains(event.location) {
                    log.clicks.append(["timeSeconds": Double(event.timestamp) / 1_000_000_000,
                                       "observedHostTimeSeconds": CMClockGetTime(CMClockGetHostTimeClock()).seconds,
                                       "eventTimestampNanoseconds": event.timestamp,
                                       "x": event.location.x, "y": event.location.y])
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: context) else {
            throw NSError(domain: "benchmark", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot observe fixture pointer events"])
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        defer { CGEvent.tapEnable(tap: tap, enable: false); CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = CGRect(x: crop[0], y: crop[1], width: crop[2], height: crop[3])
        configuration.width = Int(crop[2] * 2); configuration.height = Int(crop[3] * 2)
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 120)
        configuration.queueDepth = 8; configuration.showsCursor = false
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        let recorder = Recorder(), queue = DispatchQueue(label: "coloride.benchmark.capture")
        let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration, delegate: nil)
        try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: queue)
        try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
        try await stream.startCapture()
        emit(["status": "recording", "pid": pid, "windowID": window.windowID, "seconds": duration,
              "crop": crop, "windowFrame": [window.frame.minX, window.frame.minY, window.frame.width, window.frame.height],
              "hostTimeSeconds": CMClockGetTime(CMClockGetHostTimeClock()).seconds])
        try await Task.sleep(for: .seconds(duration))
        try await stream.stopCapture()
        // Copy and OCR after recording; Vision and PNG encoding never run in the timed interval.
        let frames = queue.sync { recorder.frames }
        let clicks = log.clicks
        var observations: [[String: Any]] = []
        var lastPixels: Data?, lastText = ""
        for (index, frame) in frames.enumerated() {
            guard let provider = CGDataProvider(data: frame.data as CFData),
                  let image = CGImage(width: frame.width, height: frame.height, bitsPerComponent: 8, bitsPerPixel: 32,
                    bytesPerRow: frame.stride, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue).union(.byteOrder32Little),
                    provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { continue }
            if lastPixels != frame.data {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate; request.usesLanguageCorrection = false
                try VNImageRequestHandler(cgImage: image).perform([request])
                lastText = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
                lastPixels = frame.data
                let url = URL(fileURLWithPath: output).appendingPathComponent("frame-\(index).png")
                if let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) {
                    CGImageDestinationAddImage(destination, image, nil); CGImageDestinationFinalize(destination)
                }
            }
            observations.append(["frame": index, "timeSeconds": frame.time, "text": lastText])
        }
        let report: [String: Any] = ["method": "ScreenCaptureKit + trusted mouse event observation + offline Vision OCR",
            "pid": pid, "windowID": window.windowID, "crop": crop,
            "windowFrame": [window.frame.minX, window.frame.minY, window.frame.width, window.frame.height],
            "clicks": clicks, "frames": observations,
            "requestedFps": 120, "notes": "Actual frame timestamps, not requested FPS, determine quantization. OCR runs after capture."]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: URL(fileURLWithPath: output).appendingPathComponent("capture.json"))
        emit(["status": "recorded", "frames": frames.count, "clicks": clicks.count, "output": output])
        exit(0)
    } catch { emit(["status": "error", "error": String(describing: error)]); exit(1) }
}
RunLoop.main.run()
