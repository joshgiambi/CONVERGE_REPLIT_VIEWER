import fs from 'fs';

// Create a minimal valid GIF file
export function createMinimalGIF(): Buffer {
  // This is a 1x1 transparent GIF
  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // Header: GIF89a
    0x01, 0x00, 0x01, 0x00, // Width: 1, Height: 1
    0x80, // Global Color Table Flag
    0x00, // Background color index
    0x00, // Pixel aspect ratio
    // Global Color Table (2 colors)
    0x00, 0x00, 0x00, // Color 0: Black
    0xFF, 0xFF, 0xFF, // Color 1: White
    // Graphic Control Extension
    0x21, 0xF9, 0x04,
    0x01, // Transparent color flag
    0x00, 0x00, // Delay time
    0x00, // Transparent color index
    0x00, // Block terminator
    // Image Descriptor
    0x2C,
    0x00, 0x00, 0x00, 0x00, // Left, Top
    0x01, 0x00, 0x01, 0x00, // Width, Height
    0x00, // No local color table
    // Image Data
    0x02, // LZW minimum code size
    0x02, // Block size
    0x44, 0x01, // LZW compressed data
    0x00, // Block terminator
    // GIF Trailer
    0x3B
  ]);
}

// Test the GIF
const gif = createMinimalGIF();
fs.writeFileSync('test-minimal.gif', gif);
console.log('Created test-minimal.gif:', gif.length, 'bytes');