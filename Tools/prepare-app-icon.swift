import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: prepare-app-icon.swift pikachu-still.png output.png")
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let pikachu = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Could not load the Pikachu artwork at \(sourceURL.path)")
}

let side = 512
let colorSpace = CGColorSpaceCreateDeviceRGB()
let lightCream = CGColor(red: 1.0, green: 0.98, blue: 0.93, alpha: 1)
let warmCream = CGColor(red: 0.94, green: 0.89, blue: 0.75, alpha: 1)
let background = CGGradient(colorsSpace: colorSpace, colors: [lightCream, warmCream] as CFArray, locations: [0, 1])!

guard let context = CGContext(
    data: nil,
    width: side,
    height: side,
    bitsPerComponent: 8,
    bytesPerRow: side * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fatalError("Could not create the app icon canvas")
}

context.interpolationQuality = .high
context.drawLinearGradient(background, start: CGPoint(x: 0, y: side), end: .zero, options: [])

let artworkSide = CGFloat(side) * 0.9
let artworkRect = CGRect(
    x: (CGFloat(side) - artworkSide) / 2,
    y: (CGFloat(side) - artworkSide) / 2,
    width: artworkSide,
    height: artworkSide
)
context.draw(pikachu, in: artworkRect)

guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Could not write the app icon image")
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
    fatalError("Could not finish writing the app icon image")
}
