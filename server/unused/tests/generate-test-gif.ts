import fs from 'fs';
import path from 'path';

// Generate a test GIF using a known working GIF structure
const testGif = Buffer.from([
  // GIF Header
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
  
  // Logical Screen Descriptor
  0x0A, 0x00, // Width: 10 pixels
  0x0A, 0x00, // Height: 10 pixels
  0xF0, // Global Color Table Flag = 1, Color Resolution = 7, Sort Flag = 0, Size of Global Color Table = 0
  0x00, // Background Color Index
  0x00, // Pixel Aspect Ratio
  
  // Global Color Table (2 colors: black and white)
  0x00, 0x00, 0x00, // Color 0: Black
  0xFF, 0xFF, 0xFF, // Color 1: White
  
  // Graphics Control Extension
  0x21, // Extension Introducer
  0xF9, // Graphic Control Label
  0x04, // Block Size
  0x00, // Packed Fields
  0x00, 0x00, // Delay Time
  0x00, // Transparent Color Index
  0x00, // Block Terminator
  
  // Image Descriptor
  0x2C, // Image Separator
  0x00, 0x00, // Image Left Position
  0x00, 0x00, // Image Top Position
  0x0A, 0x00, // Image Width: 10
  0x0A, 0x00, // Image Height: 10
  0x00, // Packed Fields
  
  // Image Data
  0x02, // LZW Minimum Code Size
  0x16, // Block Size
  0x8C, 0x2D, 0x99, 0x87, 0x2A, 0x1C, 0xDC, 0x33, 0xA0, 0x02, 0x75,
  0xEC, 0x95, 0xFA, 0xA8, 0xDE, 0x60, 0x8C, 0x04, 0x91, 0x4C, 0x01,
  0x00, // Block Terminator
  
  // Trailer
  0x3B
]);

// Save test GIF
const testPath = path.join('uploads', 'gif-cache', 'test-static.gif');
fs.writeFileSync(testPath, testGif);
console.log('Created test GIF at:', testPath, 'Size:', testGif.length, 'bytes');