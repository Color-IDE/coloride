// Fixture-only native input: every action is bound to a verified process/window.
import AppKit
import ApplicationServices
import CoreMedia
import ScreenCaptureKit
import Vision
func emit(_ value: [String: Any]) { print(String(data: try! JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]),encoding:.utf8)!); fflush(stdout) }
func arg(_ key:String)->String? { guard let i=CommandLine.arguments.firstIndex(of:key),i+1<CommandLine.arguments.count else{return nil};return CommandLine.arguments[i+1] }
guard let pid=arg("--pid").flatMap(Int32.init) else { fatalError("--pid required") }
let app=NSApplication.shared;app.setActivationPolicy(.accessory)
func value(_ node:AXUIElement,_ key:String)->CFTypeRef? {var out:CFTypeRef?;AXUIElementCopyAttributeValue(node,key as CFString,&out);return out}
Task { @MainActor in
 do {
  guard NSRunningApplication(processIdentifier:pid)?.activate(options:[]) == true else {fatalError("Cannot activate fixture")}
  let fixtureAX=AXUIElementCreateApplication(pid)
  for candidate in value(fixtureAX,kAXWindowsAttribute) as? [AXUIElement] ?? [] {
   AXUIElementSetAttributeValue(candidate,kAXMinimizedAttribute as CFString,kCFBooleanFalse)
   AXUIElementPerformAction(candidate,kAXRaiseAction as CFString)
  }
  try await Task.sleep(for:.milliseconds(300))
  let content=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
  let windows=content.windows.filter{$0.owningApplication?.processID==pid && $0.frame.height>200}
  let requested=arg("--window-id").flatMap(UInt32.init)
  let selected=windows.filter{requested == nil || $0.windowID==requested}
  guard selected.count==1,let window=selected.first else { emit(["status":"ambiguous","windows":windows.map{["id":$0.windowID,"title":$0.title ?? "","frame":[$0.frame.minX,$0.frame.minY,$0.frame.width,$0.frame.height]] as [String:Any]}]);exit(2) }
  let ax=AXUIElementCreateApplication(pid)
  let axWindows=value(ax,kAXWindowsAttribute) as? [AXUIElement] ?? []
  let standardWindows=axWindows.filter{(value($0,kAXSubroleAttribute) as? String)==kAXStandardWindowSubrole}
  let axWindow=axWindows.first(where:{(value($0,kAXTitleAttribute) as? String)==window.title}) ?? (standardWindows.count==1 ? standardWindows.first:nil) ?? (axWindows.count==1 ? axWindows.first:nil)
  if let bounds=arg("--bounds")?.split(separator:",").compactMap({Double($0)}),bounds.count==4 {
   var size=CGSize(width:bounds[2],height:bounds[3]),point=CGPoint(x:bounds[0],y:bounds[1])
   if let axWindow {
    guard AXUIElementSetAttributeValue(axWindow,kAXSizeAttribute as CFString,AXValueCreate(.cgSize,&size)!) == .success,
     AXUIElementSetAttributeValue(axWindow,kAXPositionAttribute as CFString,AXValueCreate(.cgPoint,&point)!) == .success else {fatalError("Cannot set fixture bounds")}
   } else {
    func drag(_ from:CGPoint,_ to:CGPoint) async throws {
     guard NSWorkspace.shared.frontmostApplication?.processIdentifier==pid else {fatalError("Fixture lost focus")}
     CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:from,mouseButton:.left)?.post(tap:.cghidEventTap)
     try await Task.sleep(for:.milliseconds(100))
     CGEvent(mouseEventSource:nil,mouseType:.leftMouseDragged,mouseCursorPosition:to,mouseButton:.left)?.post(tap:.cghidEventTap)
     try await Task.sleep(for:.milliseconds(100))
     CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:to,mouseButton:.left)?.post(tap:.cghidEventTap)
     try await Task.sleep(for:.milliseconds(300))
    }
    try await drag(CGPoint(x:window.frame.maxX-1,y:window.frame.maxY-1),CGPoint(x:window.frame.minX+size.width-1,y:window.frame.minY+size.height-1))
    try await drag(CGPoint(x:window.frame.minX+100,y:window.frame.minY+15),CGPoint(x:point.x+100,y:point.y+15))
   }
   emit(["status":"bounds-set"]);exit(0)
  }
  if let path=arg("--clicks") {
   let points=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:path))) as! [[String:Double]]
   guard NSRunningApplication(processIdentifier:pid)?.activate(options:[]) == true else {fatalError("Cannot activate fixture")}
   if let axWindow { AXUIElementPerformAction(axWindow,kAXRaiseAction as CFString) }
   try await Task.sleep(for:.milliseconds(500))
   for item in points {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier==pid else {fatalError("Fixture lost focus; block invalid")}
    let info=CGWindowListCopyWindowInfo([.optionIncludingWindow],window.windowID) as? [[String:Any]] ?? []
    guard let windowInfo=info.first,let raw=windowInfo[kCGWindowBounds as String] as? NSDictionary,
      let frame=CGRect(dictionaryRepresentation:raw),windowInfo[kCGWindowOwnerPID as String] as? Int32 == pid else {fatalError("Fixture bounds unavailable")}
    let actual=frame.origin,actualSize=frame.size
    guard abs(actualSize.width-window.frame.width)<1 && abs(actualSize.height-window.frame.height)<1 else {fatalError("Fixture geometry changed")}
    let point=CGPoint(x:actual.x+item["x"]!,y:actual.y+item["y"]!)
    guard CGRect(origin:actual,size:actualSize).contains(point) else {fatalError("Click outside fixture")}
    CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap)
    CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap)
    emit(["status":"clicked","fileId":item["fileId"] ?? -1,"hostTimeSeconds":CMClockGetTime(CMClockGetHostTimeClock()).seconds])
    try await Task.sleep(for:.milliseconds(600))
   }
   exit(0)
  }
  let configuration=SCStreamConfiguration();configuration.width=Int(window.frame.width*2);configuration.height=Int(window.frame.height*2);configuration.showsCursor=false
  let image=try await SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:window),configuration:configuration)
  let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate;request.usesLanguageCorrection=false
  try VNImageRequestHandler(cgImage:image).perform([request])
  let rows=(request.results ?? []).compactMap { item -> [String:Any]? in
   guard let text=item.topCandidates(1).first?.string else {return nil};let box=item.boundingBox
   return ["text":text,"x":(box.minX+box.width/2)*window.frame.width,"y":(1-box.minY-box.height/2)*window.frame.height]
  }
  emit(["status":"inspected","pid":pid,"windowID":window.windowID,"title":window.title ?? "","frame":[window.frame.minX,window.frame.minY,window.frame.width,window.frame.height],"ocr":rows])
  exit(0)
 }catch {emit(["status":"error","error":String(describing:error)]);exit(1)}
}
RunLoop.main.run()
