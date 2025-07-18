import { createCanvas } from 'canvas';
import GIFEncoder from 'gifencoder';
import fs from 'fs';

export async function createTestGIF(): Promise<Buffer> {
  const width = 256;
  const height = 256;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  const encoder = new GIFEncoder(width, height);
  
  // Create a write stream instead of using getData()
  const stream = encoder.createWriteStream();
  const chunks: Buffer[] = [];
  
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(500);
  encoder.setQuality(10);
  
  // Create 3 simple frames
  for (let i = 0; i < 3; i++) {
    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    // Draw a simple shape
    ctx.fillStyle = `hsl(${i * 120}, 100%, 50%)`;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 50, 0, Math.PI * 2);
    ctx.fill();
    
    // Add text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Frame ${i + 1}`, width / 2, height / 2 + 80);
    
    encoder.addFrame(ctx);
  }
  
  encoder.finish();
  
  // Wait for stream to finish
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return Buffer.concat(chunks);
}