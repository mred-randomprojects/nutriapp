#!/usr/bin/env swift
// Run on macOS: swift scripts/generate-app-icons.swift public/icons
// PNGs are committed so builds on other platforms need no image/font tooling.
import AppKit
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "public/icons", isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let sizes: [(String, Int, CGFloat)] = [
    ("favicon-32.png", 32, 0.82),
    ("apple-touch-icon.png", 180, 0.76),
    ("icon-192.png", 192, 0.76),
    ("icon-512.png", 512, 0.76),
    ("icon-1024.png", 1024, 0.76),
    ("icon-maskable-512.png", 512, 0.60),
]
for (name, pixels, scale) in sizes {
    let side = CGFloat(pixels)
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    bitmap.size = NSSize(width: side, height: side)
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    NSColor(srgbRed: 10/255, green: 10/255, blue: 18/255, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: side, height: side).fill()
    // Preserve NutriApp's existing salad-emoji favicon; bake it into actual PNGs
    // instead of relying on the installing browser to render an SVG emoji.
    let font = NSFont(name: "AppleColorEmoji", size: side * scale)!
    let label = NSAttributedString(string: "🥗", attributes: [.font: font])
    let size = label.size()
    label.draw(at: NSPoint(x: (side - size.width) / 2, y: (side - size.height) / 2))
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(name))
    print("Generated \(name) (\(pixels) × \(pixels))")
}
